import { catalogServiceCodes } from './preview-profile'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/supabase/server'
import { GET as previewPromo } from '@/app/api/public/promo-preview/route'
import {
  loadBookableCatalog,
  type BookableCatalogRow,
} from '@/lib/ops/bookable-catalog'
import { MINIMUM_JOB_TOTAL } from '@/lib/ops/booking-pricing'
import {
  createAiStyleBooking,
  GOOGLE_LSA_LEAD_RECOVERY_AMOUNT,
} from '@/lib/ops/create-ai-style-booking'
import {
  commercialEstimateCalendarMinutes,
  createAiStyleEstimate,
} from '@/lib/ops/create-ai-style-estimate'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  timeToMinutes,
} from '@/lib/ops/availability'
import {
  getUnionedSlots,
  getSlotsForStaff,
  getStaffPrioritizedSlots,
} from '@/lib/ops/staff-availability'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { shiftDateKey } from '@/lib/tech/day-schedule'
import { checkServiceArea } from '@/lib/service-area'
import { issueQuoteRef, quotedMinutes } from './call-token'
import { claimVoiceAction, finishVoiceAction, getVoiceSession } from './records'

type Context = {
  callSid: string
  callerPhone: string
  preview: boolean
  googleLsa?: boolean
}
type DB = ReturnType<typeof createAdminClient>
class CallerInputError extends Error {}
class UnverifiedSource extends CallerInputError {}
const mt = 'America/Denver'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: mt })
const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T12:00:00Z')
    return (
      value >= today() &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
  }, 'Choose an upcoming Mountain Time calendar date.')
const timeInput = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const zipInput = z.string().regex(/^\d{5}$/)
const textField = z.string().trim().min(1).max(150)
const sourceInput = z.enum([
  'google_lsa',
  'google_search',
  'google_unsure',
  'nextdoor',
  'facebook',
  'instagram',
  'yelp',
  'vehicle_wrap',
  'door_hanger',
  'business_card',
  'nfc_partner',
  'referral',
  'repeat_customer',
  'other',
])
const catalogSchema = z.object({ search: z.string().trim().max(80).optional() })
const callerLookupSchema = z.object({
  first_name: textField.optional(),
  last_name: textField.optional(),
})
const serviceSchema = z.object({
  zip_code: zipInput,
  line_items: z
    .array(
      z.object({
        service_id: z.uuid(),
        quantity: z.number().min(1).max(10000),
      }),
    )
    .min(1)
    .max(24),
  lead_source: sourceInput
    .optional()
    .describe(
      'Omit until the caller gives a source. Optional for estimates and available times; required for final residential booking.',
    ),
  lead_detail: textField.optional(),
  coupon_code: z.string().trim().max(32).optional(),
})
const appointmentSchema = z.object({
  visit_type: z.enum(['residential_service', 'commercial_measurement']),
  appointment_date: dateInput,
  zip_code: zipInput,
  service: serviceSchema.optional(),
})
const searchDates = {
  appointment_date: dateInput
    .optional()
    .describe('Only for an exact requested day. Omit for next available.'),
  search_from: dateInput
    .optional()
    .describe(
      'Earliest acceptable day for a forward search. Defaults to today in Mountain Time.',
    ),
}
type SearchDates = { appointment_date?: string; search_from?: string }
const oneSearchMode = (input: SearchDates) =>
  !(input.appointment_date && input.search_from)
const searchModeError = 'Choose an exact day or a forward search.'
const openingsSchema = appointmentSchema
  .extend(searchDates)
  .refine(oneSearchMode, searchModeError)
const quotedOpeningsSchema = z
  .object({ quote_ref: z.string().max(32), ...searchDates })
  .refine(oneSearchMode, searchModeError)
const bookingSchema = appointmentSchema.extend({
  start_time: timeInput,
  first_name: textField,
  last_name: textField,
  email: z.email(),
  street: textField,
  city: textField,
  accepted_minimum_charge: z
    .boolean()
    .describe(
      'Set false for normal quotes. True only when a minimum adjustment applied and the caller explicitly accepted it.',
    ),
  customer_confirmed: z.boolean(),
  customer_ref: z.uuid().optional(),
  service_address_ref: z.uuid().optional(),
  business_name: textField.optional(),
  job_description: z.string().trim().max(1000).optional(),
  lead_source: sourceInput.optional(),
  lead_detail: textField.optional(),
})
const changeSchema = z.object({
  confirmation: z.string().regex(/^(SC|EST)-[0-9a-f]{8}$/i),
  last_name: textField,
  change: z.enum(['cancel', 'reschedule']),
  new_date: dateInput.optional(),
  new_time: timeInput.optional(),
})

export const phoneTools = [
  {
    name: 'phone_caller_lookup',
    description:
      'Check the verified incoming phone number for an existing Sightings customer. Use at call start, when asked who is calling, or before booking. With no name, it may return a first name Harry should propose by asking “Is this [name]?” Never ask for the caller’s phone number. Confirm the proposed name before using saved contact details or locations.',
    inputSchema: callerLookupSchema,
  },
  {
    name: 'phone_catalog',
    description:
      'Read public cleaning services with current names, units and prices. Start as soon as the service is known, even if you still need to ask for ZIP or room count. Omit search for the whole catalog.',
    inputSchema: catalogSchema,
  },
  {
    name: 'phone_service_area',
    description: 'Check service coverage and travel charge for one ZIP.',
    inputSchema: z.object({ zip_code: zipInput }),
  },
  {
    name: 'phone_quote',
    description:
      'Compute a residential quote from the confirmed services, current catalog, ZIP and one customer-supplied coupon. Omit an unknown lead source to get the standard estimate now.',
    inputSchema: serviceSchema,
  },
  {
    name: 'phone_quoted_openings',
    description:
      'Fast live calendar lookup after a residential quote. Copy quote_ref from the latest tool result for this job. Omit dates for next available. If the job changed, update the quote first.',
    inputSchema: quotedOpeningsSchema,
  },
  {
    name: 'phone_openings',
    description:
      'Find the earliest live Mountain Time opening that fits the entire visit. For next available, omit both dates. For on or after a date, use search_from. Use appointment_date only for a specific day. Use phone_quoted_openings if the current job already has a quote_ref.',
    inputSchema: openingsSchema,
  },
  {
    name: 'phone_preview_booking',
    description:
      'After the caller confirms the complete visit, revalidate the price and opening. A verified saved customer defaults to repeat_customer when no newer source was supplied. Private test calls return a simulation; live after-hours calls create the appointment or commercial walkthrough and return its confirmation.',
    inputSchema: bookingSchema,
  },
  {
    name: 'phone_preview_change',
    description:
      'Check an existing future booking against the inbound caller, last name and confirmation code. Private tests simulate the request; live callers leave a verified office message because direct changes are not enabled.',
    inputSchema: changeSchema,
  },
]

type CallerCustomer = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  business_name: string | null
  email: string | null
  updated_at: string | null
}

type CallerAddress = {
  id: string
  customer_id: string
  label: string | null
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
}

function normalizedWords(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function customerName(row: CallerCustomer) {
  return (
    normalizedWords(row.full_name) ||
    normalizedWords(`${row.first_name || ''} ${row.last_name || ''}`) ||
    normalizedWords(row.business_name)
  )
}

function matchingCallerCustomers(
  customers: CallerCustomer[],
  input: z.infer<typeof callerLookupSchema>,
) {
  const first = normalizedWords(input.first_name)
  const last = normalizedWords(input.last_name)
  if (!first && !last) return customers

  const exact = customers.filter((row) => {
    const rowFirst = normalizedWords(row.first_name)
    const rowLast = normalizedWords(row.last_name)
    const full = customerName(row)
    if (first && last)
      return (
        (rowFirst === first && rowLast === last) ||
        full === `${first} ${last}` ||
        normalizedWords(row.business_name) === `${first} ${last}`
      )
    if (first) return rowFirst === first || full.split(' ')[0] === first
    return rowLast === last || full.split(' ').at(-1) === last
  })
  if (exact.length) return exact

  // Phone transcription occasionally mangles a surname. An exact first-name
  // match on the verified inbound number is enough to keep looking, but Harry
  // still has to confirm a saved service location before booking.
  if (first)
    return customers.filter((row) => normalizedWords(row.first_name) === first)
  return []
}

function addressKey(row: CallerAddress) {
  return (
    normalizedWords(row.street_1)
      .replace(/\b(?:lane|ln)\b/g, 'ln')
      .replace(/\b(?:street|st)\b/g, 'st')
      .replace(/\b(?:road|rd)\b/g, 'rd')
      .replace(/\b(?:avenue|ave)\b/g, 'ave') + `|${row.zip_code}`
  )
}

async function loadCustomersByPhone(
  callerPhone: string,
  db: DB,
  signal?: AbortSignal,
) {
  const variants = opsPhoneLookupVariants(callerPhone)
  if (!variants.length) return [] as CallerCustomer[]
  let query = db
    .from('ops_customers')
    .select('id,full_name,first_name,last_name,business_name,email,updated_at')
    .in('phone', variants)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(20)
  if (signal) query = query.abortSignal(signal)
  const result = await query
  if (result.error) throw new CallerInputError('Customer lookup unavailable.')
  return (result.data || []) as CallerCustomer[]
}

async function loadCallerCustomers(ctx: Context, db: DB) {
  return loadCustomersByPhone(ctx.callerPhone, db)
}

function spokenFirstName(row: CallerCustomer | undefined) {
  const raw =
    String(row?.first_name || '').trim() ||
    String(row?.full_name || '')
      .trim()
      .split(/\s+/)[0]
  return /^[a-z][a-z'’-]{0,39}$/i.test(raw) ? raw : ''
}

export async function recognizePhoneCaller(
  callerPhone: string,
  db: DB = createAdminClient(),
  signal?: AbortSignal,
) {
  const customers = await loadCustomersByPhone(callerPhone, db, signal)
  const firstName = spokenFirstName(customers[0])
  return firstName ? { firstName, customerRef: customers[0].id } : null
}

async function callerLookup(
  input: z.infer<typeof callerLookupSchema>,
  ctx: Context,
  db: DB,
) {
  const customers = await loadCallerCustomers(ctx, db)
  if (!customers.length)
    return {
      status: 'no_match',
      caller_number_matched: false,
      guidance:
        'Collect new-customer details. Do not say the number was wrong.',
    }

  if (!input.first_name && !input.last_name)
    return {
      status: 'name_confirmation_required',
      caller_number_matched: true,
      suggested_first_name: spokenFirstName(customers[0]) || undefined,
      guidance:
        'A record exists for this incoming number. Ask “Is this [suggested_first_name]?” when a suggested name is present. This first-name confirmation is allowed. If they say no, ask who is calling and look up that name. Do not reveal a last name, email or address before confirmation.',
    }

  const matched = matchingCallerCustomers(customers, input)
  if (!matched.length)
    return {
      status: 'name_not_matched',
      caller_number_matched: true,
      guidance:
        'The incoming number is known but the supplied name did not match. Ask once for the spelling or offer to use new-customer details; do not reveal saved names.',
    }

  const ids = matched.map((row) => row.id)
  const addressesResult = await db
    .from('ops_service_addresses')
    .select(
      'id,customer_id,label,street_1,street_2,city,state,zip_code,updated_at',
    )
    .in('customer_id', ids)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(24)
  if (addressesResult.error)
    throw new CallerInputError('Customer address lookup unavailable.')

  const seen = new Set<string>()
  const locations = ((addressesResult.data || []) as CallerAddress[])
    .filter((row) => {
      const key = addressKey(row)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
    .map((row) => ({
      customer_ref: row.customer_id,
      service_address_ref: row.id,
      label: row.label,
      street: row.street_1,
      street_2: row.street_2,
      city: row.city,
      state: row.state,
      zip_code: row.zip_code,
    }))
  const primary = matched[0]
  return {
    status: 'existing_customer',
    caller_number_matched: true,
    customer_ref: primary.id,
    customer: {
      first_name: primary.first_name,
      last_name: primary.last_name,
      business_name: primary.business_name,
      email: primary.email,
    },
    saved_locations: locations,
    guidance: locations.length
      ? 'Confirm the caller name and which saved street this job is for. Do not read the email aloud. For a saved location, copy both refs from that location into phone_preview_booking.'
      : 'Confirm the caller name, then collect the service address. Reuse customer_ref and omit service_address_ref for a new location.',
  }
}

// Only the private dispatcher advertises human-readable catalog codes. Parse
// them to canonical IDs at the MCP boundary before existing quote/booking rules.
export function previewPhoneTools(catalog: BookableCatalogRow[]) {
  const codes = catalogServiceCodes(catalog)
  if (!codes.size) return phoneTools
  const serviceId = z.union([
    z.enum(Array.from(codes.keys())).overwrite((code) => codes.get(code)!),
    z.uuid(),
  ])
  const items = serviceSchema.shape.line_items
  const service = serviceSchema.extend({
    line_items: z
      .array(items.element.extend({ service_id: serviceId }))
      .min(1)
      .max(24),
  })
  const schemas: Record<string, z.ZodType> = {
    phone_quote: service,
    phone_openings: appointmentSchema
      .extend({ service: service.optional(), ...searchDates })
      .refine(oneSearchMode, searchModeError),
    phone_preview_booking: bookingSchema.extend({
      service: service.optional(),
    }),
  }
  return phoneTools.map((tool) => ({
    ...tool,
    inputSchema: schemas[tool.name] ?? tool.inputSchema,
  }))
}

function earliestStart(date: string) {
  if (date !== today()) return undefined
  return (
    timeToMinutes(
      new Date().toLocaleTimeString('en-GB', {
        timeZone: mt,
        hour: '2-digit',
        minute: '2-digit',
      }),
    ) + 60
  )
}

async function couponAmount(code: string, subtotal: number, services: number) {
  if (!code) return { code: null, applied: false, amount: 0 }
  // Use the website's read-only coupon evaluator in-process. It checks eligibility,
  // expiration, remaining uses, and restrictions on private offers.
  const url = new URL(
    'https://sightings.sasquatchcarpet.com/api/public/promo-preview',
  )
  url.searchParams.set('code', code)
  url.searchParams.set('subtotal', String(subtotal))
  url.searchParams.set('service_subtotal', String(services))
  const res = await previewPromo(new NextRequest(url))
  if (res.status >= 500) throw new CallerInputError('Coupon lookup unavailable')
  const data = await res.json()
  const discount = Number(data.discount_amount)
  const applied =
    res.ok && data.applied === true && Number.isFinite(discount) && discount > 0
  return {
    code,
    applied,
    amount: applied ? Math.min(discount, subtotal) : 0,
    reason: applied
      ? undefined
      : data.reason || data.error || 'No eligible discount at this subtotal',
  }
}

async function quote(
  input: z.infer<typeof serviceSchema>,
  ctx: Context,
  db: DB,
  estimateLsa?: boolean,
) {
  const area = checkServiceArea(input.zip_code)
  if (!area.allowed)
    throw new CallerInputError(
      'Outside the standard booking area. Offer office follow-up.',
    )
  if (
    estimateLsa === undefined &&
    !ctx.googleLsa &&
    input.lead_source === 'google_unsure'
  )
    throw new UnverifiedSource(
      'Ask whether the caller used a Google Local Services ad or regular search. Source affects the total.',
    )
  let lsa = estimateLsa ?? ctx.googleLsa === true
  if (estimateLsa === undefined && !lsa && input.lead_source === 'google_lsa') {
    const session = await getVoiceSession(ctx.callSid, db)
    // A model-supplied source is insufficient. A positive reply must corroborate
    // the specific attribution, rather than just mentioning Google.
    let callerConfirmed = false
    const ad = /\b(?:google guaranteed|local services? ads?|lsa)\b/i
    for (const [i, turn] of (session?.turns ?? []).entries()) {
      if (turn.role !== 'user') continue
      const prior = session?.turns[i - 1]
      const adQuestion =
        prior?.role === 'assistant' &&
        ad.test(prior.content) &&
        !/\bor\b/i.test(prior.content)
      if (!ad.test(turn.content) && !adQuestion) continue
      const denial =
        /\b(no|not|never|unsure|maybe|regular search|google maps|don['’]t|didn.t|wasn.t|can.t)\b/i
      if (denial.test(turn.content)) {
        callerConfirmed = false
        continue
      }
      if (
        adQuestion &&
        /^\s*(?:yes|yeah|correct|right|that.s right)\b/i.test(turn.content)
      )
        callerConfirmed = true
      if (
        ad.test(turn.content) &&
        (/^\s*(?:(?:an?|the|it was (?:an?|the)) )?(?:google )?(?:local services? ads?|google guaranteed|lsa)[.!\s]*$/i.test(
          turn.content,
        ) ||
          (/\b(?:found|called|came|clicked|through|from|used|saw)\b/i.test(
            turn.content,
          ) &&
            !/[?]|\b(?:if|whether|either)\b/i.test(turn.content)))
      )
        callerConfirmed = true
    }
    if (!callerConfirmed)
      throw new UnverifiedSource(
        'Google LSA attribution is unverified. Ask the caller to state the source, or give conditional pricing. No fee has been applied.',
      )
    lsa = true
  }
  const catalog = await loadBookableCatalog(db)
  const lines = input.line_items.map((line) => {
    const item = catalog.find((service) => service.id === line.service_id)
    if (
      !item ||
      item.base_price === null ||
      !Number.isFinite(item.base_price) ||
      item.base_price <= 0
    )
      throw new CallerInputError(
        'A selected service has no public bookable price. Verify the catalog or offer a callback.',
      )
    return {
      name: item.name,
      quantity: line.quantity,
      unit_price: item.base_price,
    }
  })
  const services = lines.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  )
  const leadFee = lsa ? GOOGLE_LSA_LEAD_RECOVERY_AMOUNT : 0
  const subtotalBeforeMinimum = services + leadFee + area.travelCharge
  const subtotal = Math.max(MINIMUM_JOB_TOTAL, subtotalBeforeMinimum)
  const coupon = await couponAmount(
    (input.coupon_code || '').toUpperCase().replace(/\s+/g, ''),
    subtotal,
    services,
  )
  const duration = applyAppointmentBuffer(
    calculateAppointmentDurationFromTotal(
      services + subtotal - subtotalBeforeMinimum,
    ),
  )
  return {
    ...(!ctx.googleLsa &&
      (!input.lead_source || input.lead_source === 'google_unsure') && {
        status: 'standard_estimate' as const,
      }),
    lines,
    service_subtotal: services,
    travel_fee: area.travelCharge,
    lsa_fee: leadFee,
    minimum_charge_applied: subtotalBeforeMinimum < MINIMUM_JOB_TOTAL,
    ...(subtotalBeforeMinimum < MINIMUM_JOB_TOTAL && {
      minimum_charge: MINIMUM_JOB_TOTAL,
    }),
    minimum_adjustment: subtotal - subtotalBeforeMinimum,
    subtotal,
    coupon,
    total: Math.round((subtotal - coupon.amount) * 100) / 100,
    duration_minutes: duration,
    quote_ref: issueQuoteRef(ctx.callSid, duration),
  }
}

async function openings(
  input: z.infer<typeof openingsSchema>,
  ctx: Context,
  db: DB,
) {
  if (!checkServiceArea(input.zip_code).allowed)
    throw new CallerInputError(
      'Outside the standard booking area. Offer to take a message.',
    )
  if (
    input.visit_type === 'residential_service' &&
    (!input.service || input.zip_code !== input.service.zip_code)
  )
    throw new CallerInputError(
      'Supply the priced service items and the matching service ZIP.',
    )
  const price =
    input.visit_type === 'residential_service' && input.service
      ? await quote(
          input.service,
          ctx,
          db,
          input.service.lead_source === 'google_unsure' && !ctx.googleLsa
            ? false
            : undefined,
        )
      : undefined
  const calendar = await searchOpenings(
    input,
    input.visit_type,
    price?.duration_minutes ?? commercialEstimateCalendarMinutes(),
    db,
  )
  return { ...calendar, quote: price }
}

async function searchOpenings(
  input: SearchDates,
  visitType: z.infer<typeof appointmentSchema>['visit_type'],
  requiredMinutes: number,
  db: DB,
) {
  const firstDate = input.appointment_date ?? input.search_from ?? today()
  const daysToCheck = input.appointment_date ? 1 : 14
  async function checkDay(date: string) {
    const query = {
      supabase: db,
      date,
      requiredMinutes,
      minStartMinutes: earliestStart(date),
      maxResults: 32,
    }
    const slots =
      visitType === 'commercial_measurement'
        ? (await getStaffPrioritizedSlots(query))?.slots || []
        : await getUnionedSlots(query)
    return {
      date,
      times: slots.map((slot) => slot.start_time.slice(0, 5)),
      timezone: mt,
    }
  }
  // Overlap nearby live reads but evaluate in date order, even if a later
  // day returns first. An error before a match cannot establish the earliest time.
  const batchSize = 3
  for (let offset = 0; offset < daysToCheck; offset += batchSize) {
    const batch = await Promise.allSettled(
      Array.from(
        { length: Math.min(batchSize, daysToCheck - offset) },
        (_, i) => checkDay(shiftDateKey(firstDate, offset + i)),
      ),
    )
    for (const day of batch) {
      if (day.status === 'rejected') throw day.reason
      if (day.value.times.length || input.appointment_date) return day.value
    }
  }
  return {
    searched_from: firstDate,
    searched_through: shiftDateKey(firstDate, daysToCheck - 1),
    next_search_from: shiftDateKey(firstDate, daysToCheck),
    timezone: mt,
    times: [] as string[],
  }
}

function bookingActionKey(input: z.infer<typeof bookingSchema>) {
  return (
    'booking_' +
    createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex')
      .slice(0, 40)
  )
}

async function bookVisit(
  input: z.infer<typeof bookingSchema>,
  ctx: Context,
  db: DB,
) {
  if (!input.customer_confirmed)
    throw new CallerInputError(
      'Read back the exact visit and get confirmation first.',
    )
  const callerCustomers = await loadCallerCustomers(ctx, db)
  let storedCustomer: CallerCustomer | undefined
  let storedAddress: CallerAddress | undefined
  if (input.customer_ref || input.service_address_ref) {
    if (!input.customer_ref)
      throw new CallerInputError(
        'Select the customer record that owns the saved address.',
      )
    storedCustomer = callerCustomers.find(
      (row) => row.id === input.customer_ref,
    )
    if (!storedCustomer)
      throw new CallerInputError(
        'That saved customer was not verified against the incoming number. Look up the caller again.',
      )
    if (input.service_address_ref) {
      const addressResult = await db
        .from('ops_service_addresses')
        .select('id,customer_id,label,street_1,street_2,city,state,zip_code')
        .eq('id', input.service_address_ref)
        .eq('customer_id', storedCustomer.id)
        .maybeSingle()
      if (addressResult.error)
        throw new CallerInputError('Customer address lookup unavailable.')
      storedAddress = (addressResult.data || undefined) as
        | CallerAddress
        | undefined
      if (!storedAddress)
        throw new CallerInputError(
          'That saved address does not belong to the verified caller record.',
        )
    }
  } else if (callerCustomers.length) {
    throw new CallerInputError(
      'This incoming number already has customer records. Use phone_caller_lookup and confirm the caller name before booking so a duplicate is not created.',
    )
  }
  // Once the caller confirms a saved location, its stored ZIP is the source of
  // truth. A caller may guess a nearby ZIP before the street is resolved; do
  // not let that stale answer poison the final quote or calendar recheck.
  const finalSource =
    input.service?.lead_source ||
    input.lead_source ||
    (storedCustomer ? 'repeat_customer' : undefined)
  const finalLeadDetail =
    input.service?.lead_detail || input.lead_detail || undefined
  const finalService = input.service
    ? {
        ...input.service,
        zip_code: storedAddress?.zip_code || input.service.zip_code,
        lead_source: finalSource,
        lead_detail: finalLeadDetail,
      }
    : undefined
  const finalInput = {
    ...input,
    zip_code: storedAddress?.zip_code || input.zip_code,
    service: finalService,
  }
  const available = await openings(finalInput, ctx, db)
  if (!available.times.includes(input.start_time))
    throw new CallerInputError(
      'That opening is no longer available. Check other times.',
    )
  if (input.visit_type === 'commercial_measurement') {
    if (ctx.preview)
      return {
        status: 'simulated',
        created: false,
        visit_type: input.visit_type,
        date: input.appointment_date,
        time: input.start_time,
        message:
          'This is a test only. No commercial walkthrough was scheduled.',
      }
    const actionKey = bookingActionKey(input)
    const claim = await claimVoiceAction(ctx.callSid, actionKey, db)
    if (!claim.claimed)
      return (
        claim.result || {
          error:
            'This booking request is already processing. Do not retry it; take a message for office verification.',
        }
      )
    const result = await createAiStyleEstimate({
      supabase: db,
      customer_id: storedCustomer?.id,
      service_address_id: storedAddress?.id,
      customer: {
        first_name: storedCustomer?.first_name || input.first_name,
        last_name: storedCustomer?.last_name || input.last_name,
        email: storedCustomer?.email || input.email,
        phone: ctx.callerPhone,
        business_name: input.business_name,
      },
      address: {
        street_1: storedAddress?.street_1 || input.street,
        street_2: storedAddress?.street_2 || undefined,
        city: storedAddress?.city || input.city,
        state: 'CO',
        zip_code: storedAddress?.zip_code || input.zip_code,
      },
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      visit_duration_minutes: 60,
      job_description: input.job_description,
      booking_channel: 'ai_agent',
      source_label: 'After-hours phone',
      lead_source: input.lead_source,
      lead_source_detail: input.lead_detail,
      actor_label: 'Harry after-hours phone',
      admin_heading: 'Harry commercial walkthrough',
    })
    const response: Record<string, unknown> = result.ok
      ? {
          status: 'confirmed',
          created: true,
          confirmation_number: result.confirmation_number,
          visit_type: input.visit_type,
          date: result.appointment_date,
          time: result.start_time,
          message: result.message,
        }
      : { error: result.error }
    await finishVoiceAction(
      ctx.callSid,
      actionKey,
      result.ok ? 'succeeded' : 'failed',
      response,
      db,
    ).catch((error) =>
      console.error('[Phone assistant] Could not finalize action claim', error),
    )
    return response
  }

  if (!finalService || !available.quote)
    throw new CallerInputError('Residential service details are required.')
  const source = available.quote.lsa_fee
    ? 'google_lsa'
    : finalSource
  if (!source || source === 'google_unsure')
    throw new CallerInputError(
      'Confirm the lead source and final price before booking.',
    )
  if (available.quote.minimum_charge_applied && !input.accepted_minimum_charge)
    throw new CallerInputError(
      'Obtain acceptance of the quoted service minimum.',
    )

  let verifiedDiscount:
    | { promo_id: string; code: string; amount: number }
    | undefined
  if (available.quote.coupon.applied && available.quote.coupon.code) {
    const promo = await db
      .from('promo_codes')
      .select('id,code')
      .eq('code', available.quote.coupon.code)
      .eq('active', true)
      .maybeSingle()
    if (promo.error || !promo.data)
      throw new CallerInputError(
        'The coupon changed during booking. Recheck the price or take a message.',
      )
    verifiedDiscount = {
      promo_id: promo.data.id,
      code: promo.data.code,
      amount: available.quote.coupon.amount,
    }
  }

  const common = {
    supabase: db,
    customer: {
      first_name: storedCustomer?.first_name || input.first_name,
      last_name: storedCustomer?.last_name || input.last_name,
      email: storedCustomer?.email || input.email,
      phone: ctx.callerPhone,
    },
    address: {
      street_1: storedAddress?.street_1 || input.street,
      street_2: storedAddress?.street_2 || undefined,
      city: storedAddress?.city || input.city,
      state: 'CO',
      zip_code: storedAddress?.zip_code || input.zip_code,
    },
    existing_customer_id: storedCustomer?.id,
    existing_service_address_id: storedAddress?.id,
    appointment_date: input.appointment_date,
    start_time: input.start_time,
    line_items: finalService.line_items,
    booking_mode: 'direct' as const,
    booking_channel: 'ai_agent' as const,
    lead_source: source,
    lead_source_detail: finalService.lead_detail,
    accepted_minimum_charge: input.accepted_minimum_charge,
    verified_discount: verifiedDiscount,
  }
  const checked = await createAiStyleBooking({
    ...common,
    source_label: 'After-hours phone preview',
    actor_label: 'After-hours phone preview',
    admin_heading: 'Private preview',
    preview_only: true,
    notify_internal: false,
    notify_customer: false,
    sync_quickbooks: false,
  })
  if (!checked.ok)
    throw new CallerInputError(
      'Sightings could not validate the requested booking. Check the service, source, address and time or offer office follow-up.',
    )
  if (
    Math.abs(checked.subtotal - available.quote.subtotal) > 0.01 ||
    Math.abs(checked.total - available.quote.total) > 0.01
  )
    throw new CallerInputError(
      'Booking validation returned different pricing. Ask the office to review.',
    )
  if (ctx.preview)
    return {
      status: 'simulated',
      created: false,
      visit_type: input.visit_type,
      date: input.appointment_date,
      time: input.start_time,
      quote: available.quote,
      message:
        'This is a test only. No appointment or invoice was created and no confirmation was sent.',
    }

  const actionKey = bookingActionKey(input)
  const claim = await claimVoiceAction(ctx.callSid, actionKey, db)
  if (!claim.claimed)
    return (
      claim.result || {
        error:
          'This booking request is already processing. Do not retry it; take a message for office verification.',
      }
    )
  const booked = await createAiStyleBooking({
    ...common,
    source_label: 'Harry after-hours phone',
    actor_label: 'Harry after-hours phone',
    admin_heading: 'Harry phone booking',
  })
  const response: Record<string, unknown> = booked.ok
    ? {
        status: booked.appointment_status,
        created: true,
        confirmation_number: booked.confirmation_number,
        visit_type: input.visit_type,
        date: booked.appointment_date,
        time: booked.start_time,
        total: booked.total,
        message: booked.message,
      }
    : { error: booked.error }
  await finishVoiceAction(
    ctx.callSid,
    actionKey,
    booked.ok ? 'succeeded' : 'failed',
    response,
    db,
  ).catch((error) =>
    console.error('[Phone assistant] Could not finalize action claim', error),
  )
  return response
}

async function previewChange(
  input: z.infer<typeof changeSchema>,
  ctx: Context,
  db: DB,
) {
  if (!ctx.preview)
    throw new CallerInputError(
      'Live changes are unavailable. Offer a message for the office.',
    )
  const verified = await db
    .from('ops_customers')
    .select('id,last_name')
    .in('phone', opsPhoneLookupVariants(ctx.callerPhone))
  if (verified.error) throw new CallerInputError('Booking lookup unavailable.')
  const ids = (verified.data || [])
    .filter(
      (c) =>
        String(c.last_name || '')
          .trim()
          .toLowerCase() === input.last_name.toLowerCase(),
    )
    .map((c) => c.id)
  const unavailable = 'Unable to verify this booking. Offer to take a message.'
  if (!ids.length) throw new CallerInputError(unavailable)
  const result = await db
    .from('ops_appointments')
    .select('id,kind,start_time,end_time,assigned_staff_user_id')
    .in('customer_id', ids)
    .gte('appointment_date', today())
    .in('status', ['booked', 'confirmed', 'pending_approval', 'scheduled'])
  if (result.error) throw new CallerInputError('Booking lookup unavailable.')
  const matches = (result.data || []).filter(
    (a) =>
      (
        (a.kind === 'estimate' ? 'EST-' : 'SC-') + a.id.slice(0, 8)
      ).toUpperCase() === input.confirmation.toUpperCase(),
  )
  if (matches.length !== 1) throw new CallerInputError(unavailable)
  if (input.change === 'reschedule') {
    if (!input.new_date || !input.new_time)
      throw new CallerInputError('Ask for the requested date and time.')
    const a = matches[0]
    const minutes = timeToMinutes(a.end_time) - timeToMinutes(a.start_time)
    if (minutes <= 0 || !a.assigned_staff_user_id)
      throw new CallerInputError(
        'Ask the office to review this scheduling change.',
      )
    const slots = await getSlotsForStaff({
      supabase: db,
      date: input.new_date,
      staffUserId: a.assigned_staff_user_id,
      requiredMinutes: minutes,
      excludeAppointmentId: a.id,
      minStartMinutes: earliestStart(input.new_date),
      maxResults: 32,
    })
    if (!slots.some((slot) => slot.start_time.slice(0, 5) === input.new_time))
      throw new CallerInputError(
        'The requested opening is unavailable for that visit.',
      )
  }
  return {
    status: 'simulated',
    change: input.change,
    updated: false,
    message:
      'The test change was validated. The actual appointment has not changed.',
  }
}

export async function runPhoneTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Context,
): Promise<unknown> {
  try {
    const db = createAdminClient()
    switch (name) {
      case 'phone_caller_lookup':
        return await callerLookup(callerLookupSchema.parse(args), ctx, db)
      case 'phone_catalog': {
        const { search } = catalogSchema.parse(args)
        const catalog = await loadBookableCatalog(db)
        return {
          services: catalog.filter(
            (item) =>
              !search ||
              (item.name + ' ' + item.category)
                .toLowerCase()
                .includes(search.toLowerCase()),
          ),
        }
      }
      case 'phone_service_area': {
        const zip = zipInput.parse(args.zip_code)
        const area = checkServiceArea(zip)
        return { allowed: area.allowed, travel_fee: area.travelCharge }
      }
      case 'phone_quote': {
        const input = serviceSchema.parse(args)
        try {
          return await quote(input, ctx, db)
        } catch (error) {
          if (!(error instanceof UnverifiedSource)) throw error
          const [direct, lsa] = await Promise.all([
            quote(input, ctx, db, false),
            quote(input, ctx, db, true),
          ])
          return {
            status: 'conditional_quote',
            message: error.message,
            regular_search_total: direct.total,
            local_services_ad_total: lsa.total,
            local_services_ad_fee: lsa.lsa_fee,
          }
        }
      }
      case 'phone_quoted_openings': {
        const input = quotedOpeningsSchema.parse(args)
        const minutes = quotedMinutes(ctx.callSid, input.quote_ref)
        if (minutes === null)
          throw new CallerInputError(
            'Use the latest quote_ref from this call or look up openings with the full service details.',
          )
        return await searchOpenings(input, 'residential_service', minutes, db)
      }
      case 'phone_openings':
        return await openings(openingsSchema.parse(args), ctx, db)
      case 'phone_preview_booking':
        return await bookVisit(bookingSchema.parse(args), ctx, db)
      case 'phone_preview_change':
        return await previewChange(changeSchema.parse(args), ctx, db)
      default:
        return { error: 'Unknown phone tool.' }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn('[Phone assistant] Tool validation rejected', {
        callSid: ctx.callSid,
        tool: name,
        fields: error.issues.map((issue) => issue.path.join('.')),
      })
      return {
        error: 'Required details are missing or invalid.',
        fields: error.issues.map((issue) => issue.path.join('.')),
      }
    }
    if (error instanceof CallerInputError) {
      console.warn('[Phone assistant] Tool request rejected', {
        callSid: ctx.callSid,
        tool: name,
        reason: error.message,
      })
      return { error: error.message }
    }
    console.error('[Phone assistant] Tool request failed', {
      callSid: ctx.callSid,
      tool: name,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return { error: 'Could not verify that request. Offer to take a message.' }
  }
}
