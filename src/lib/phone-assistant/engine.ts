import { createHash } from 'node:crypto'
import { commitPlannedBooking } from '@/lib/ops/commit-planned-booking'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { after, NextRequest } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/supabase/server'
import { GET as previewPromo } from '@/app/api/public/promo-preview/route'
import { bookPhoneMeasurement } from './commercial-measurement'
import {
  callerLookupSchema,
  lookupPhoneCaller,
  proposeUsualAddress,
  usualAddressSchema,
  verifiedCallerLocation,
} from './caller'
import { catalogServiceCodes } from './dispatcher-instructions'
import {
  loadBookableCatalog,
  type BookableCatalogRow,
} from '@/lib/ops/bookable-catalog'
import { MINIMUM_JOB_TOTAL } from '@/lib/ops/booking-pricing'
import {
  createAiStyleBooking,
  GOOGLE_LSA_LEAD_RECOVERY_AMOUNT,
} from '@/lib/ops/create-ai-style-booking'
import { commercialEstimateCalendarMinutes } from '@/lib/ops/create-ai-style-estimate'
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
import { getVoiceSession } from './records'

type Context = {
  callSid: string
  callerPhone: string
  preview: boolean
  googleLsa?: boolean
  isCurrent?: () => Promise<boolean>
  expectedCallerSequence?: number | null
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
  unit: textField.optional(),
  city: textField,
  accepted_minimum_charge: z
    .boolean()
    .describe(
      'Set false for normal quotes. True only when a minimum adjustment applied and the caller explicitly accepted it.',
    ),
  customer_confirmed: z.boolean(),
})
// The model may omit these fields only when the server can bind both saved IDs.
const newContactDetails = bookingSchema.pick({
  last_name: true,
  city: true,
  zip_code: true,
})
const bookingService = serviceSchema.partial({ zip_code: true })
const contactSchema = bookingSchema
  .partial({ last_name: true, city: true, zip_code: true })
  .extend({
    service: bookingService.optional(),
    unit: callerLookupSchema.shape.unit,
    customer_ref: z.uuid().optional(),
    service_address_ref: z.uuid().optional(),
    use_saved_email: z
      .boolean()
      .optional()
      .describe(
        'True only with explicit permission after a verified caller lookup.',
      ),
    email: z
      .email()
      .toLowerCase()
      .refine(isDeliverableCustomerEmail)
      .optional(),
    lead_source: sourceInput.optional(),
    lead_detail: textField.optional(),
  })
const liveBookingSchema = contactSchema.extend({
  visit_type: z.literal('residential_service'),
  service: bookingService,
  confirmed_total: z
    .number()
    .nonnegative()
    .describe('The exact final dollar amount the caller accepted at readback.'),
  email_confirmed: z
    .literal(true)
    .describe(
      'The caller confirmed the complete email spelling, including domain, or explicitly authorized reuse of the verified email on file.',
    ),
})
const measurementSchema = contactSchema
  .omit({ accepted_minimum_charge: true, service: true })
  .extend({
    ...newContactDetails.shape,
    visit_type: z.literal('commercial_measurement'),
    email_confirmed: z.literal(true),
    business_name: textField,
    job_description: z.string().trim().min(1).max(1000),
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
    name: 'phone_usual_address',
    description:
      'After the caller confirms the recognized first name, check for one saved residential street to offer. Ask if that is the service location. If the result has no offer or the caller declines, ask for the house number and street. Use phone_caller_lookup to verify the address the caller confirms.',
    inputSchema: usualAddressSchema,
  },
  {
    name: 'phone_caller_lookup',
    description:
      'Verify the confirmed first name and either the saved street the caller just accepted or the house number and street they supplied or corrected. Pass any unit, city and ZIP from the accepted address offer. Ask for a unit or surname only if the lookup requests it. For a business include the caller-supplied business name and contact surname. Returns references for the verified location.',
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
      'Revalidate a selected upcoming visit and simulate it for the owner test. This tool never creates a real appointment or invoice.',
    inputSchema: contactSchema,
  },
  {
    name: 'phone_preview_change',
    description:
      'Check an existing future booking against the inbound caller, last name and confirmation code, then simulate a cancellation or proposed reschedule. No changes are saved.',
    inputSchema: changeSchema,
  },
]

const liveBookingTool = {
  name: 'phone_book_service',
  description:
    'Save a live residential appointment and its invoice after the caller accepts the exact job, price and time. For a verified returning caller, reuse customer_ref and service_address_ref with the confirmed first name and street. Omit unknown surname, city and ZIP. New callers must supply them. Only a booked receipt with a confirmation number means success. A quote, availability, caller agreement, missing details or an error does not reserve anything.',
  inputSchema: liveBookingSchema,
}
const measurementTool = {
  name: 'phone_book_measurement',
  description:
    'Book a commercial measuring visit only after the caller confirms their business, address and exact slot. No residential quote, price or invoice. Only a booked receipt confirms the measurement.',
  inputSchema: measurementSchema,
}

export function phoneToolsForCall(
  preview: boolean,
  catalog: BookableCatalogRow[] = [],
) {
  const tools = preview
    ? phoneTools
    : [
        ...phoneTools.filter((t) => !t.name.startsWith('phone_preview_')),
        liveBookingTool,
        measurementTool,
      ]
  const codes = catalogServiceCodes(catalog)
  if (!codes.size) return tools
  const serviceId = z.union([
    z.enum(Array.from(codes.keys())).overwrite((code) => codes.get(code)!),
    z.uuid(),
  ])
  const service = serviceSchema.extend({
    line_items: z
      .array(
        serviceSchema.shape.line_items.element.extend({
          service_id: serviceId,
        }),
      )
      .min(1)
      .max(24),
  })
  const schemas: Record<string, z.ZodType> = {
    phone_quote: service,
    phone_openings: appointmentSchema
      .extend({ service: service.optional(), ...searchDates })
      .refine(oneSearchMode, searchModeError),
    phone_preview_booking: contactSchema.extend({
      service: service.partial({ zip_code: true }).optional(),
    }),
    phone_book_service: liveBookingSchema.extend({
      service: service.partial({ zip_code: true }),
    }),
  }
  return tools.map((t) => ({
    ...t,
    inputSchema: schemas[t.name] ?? t.inputSchema,
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

// Bind saved details again at write time, even if a model supplies another
// customer's reference. No CRM email is returned to the model.
async function resolveContact<
  T extends z.infer<typeof contactSchema> | z.infer<typeof measurementSchema>,
>(input: T, ctx: Context, db: DB) {
  if (
    !input.customer_ref &&
    !input.service_address_ref &&
    !input.use_saved_email
  ) {
    if (!input.email)
      throw new CallerInputError(
        'Ask for the email and confirm the spelling, or take an office message.',
      )
    return {
      ...input,
      ...newContactDetails.parse(input),
      unit: input.unit || undefined,
      email: input.email,
      verifiedCustomer: false,
    }
  }
  const saved = await verifiedCallerLocation(ctx.callerPhone, input, db)
  if (
    !saved ||
    saved.customer.id !== input.customer_ref ||
    saved.address.id !== input.service_address_ref
  )
    throw new CallerInputError(
      'The saved contact or location could not be verified. Use caller-supplied details or take an office message.',
    )
  const email = (
    input.use_saved_email ? saved.customer.email : input.email
  )?.trim()
  if (!isDeliverableCustomerEmail(email) || !z.email().safeParse(email).success)
    throw new CallerInputError(
      'Ask for a verified email address or take an office message.',
    )
  return {
    ...input,
    first_name: saved.customer.first_name,
    last_name: saved.customer.last_name,
    street: saved.address.street_1,
    unit: saved.address.street_2?.trim() || undefined,
    city: saved.address.city,
    zip_code: saved.address.zip_code,
    email,
    verifiedCustomer: true,
  }
}

async function checkOrBook(
  input: z.infer<typeof bookingSchema>,
  ctx: Context,
  db: DB,
  live?: z.infer<typeof liveBookingSchema>,
) {
  if (!input.customer_confirmed)
    throw new CallerInputError(
      'Read back the exact visit and get confirmation first.',
    )
  const customer = {
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email,
    phone: ctx.callerPhone,
  }
  let calendarVersion = ''
  let requestHash: string | undefined
  if (live) {
    if (ctx.preview)
      throw new CallerInputError(
        'Private test calls can only simulate bookings.',
      )
    requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          ...bookingSchema.parse(input),
          confirmed_total: live.confirmed_total,
          email_confirmed: live.email_confirmed,
          ...(live.customer_ref && {
            verified_customer_id: live.customer_ref,
            verified_service_address_id: live.service_address_ref,
          }),
        }),
      )
      .digest('hex')
    // A retry after a lost response must recover the receipt before rechecking
    // availability: the newly committed appointment now occupies its own slot.
    const saved = await db
      .from('ops_appointments')
      .select(
        'id,status,parked_at,appointment_date,start_time,quoted_total,phone_assistant_request_hash',
      )
      .eq('phone_assistant_call_sid', ctx.callSid)
      .maybeSingle()
    if (saved.error) throw saved.error
    if (saved.data) {
      const row = saved.data
      if (
        row.phone_assistant_request_hash !== requestHash ||
        !['booked', 'confirmed'].includes(row.status) ||
        row.parked_at != null ||
        row.appointment_date !== input.appointment_date ||
        row.start_time.slice(0, 5) !== input.start_time ||
        Number(row.quoted_total) !== live.confirmed_total
      ) {
        throw new CallerInputError(
          'A different job or schedule is already linked to this call. Take an office callback request.',
        )
      }
      return {
        status: 'booked',
        appointment_id: row.id,
        confirmation_number: 'SC-' + row.id.slice(0, 8).toUpperCase(),
        date: row.appointment_date,
        time: row.start_time.slice(0, 5),
        total: Number(row.quoted_total),
      }
    }
    const snapshot = await db.rpc('phone_booking_calendar_version', {
      p_date: input.appointment_date,
      p_contact: customer,
    })
    if (snapshot.error || typeof snapshot.data !== 'string' || !snapshot.data)
      throw new CallerInputError(
        'The schedule could not be verified. Offer an office callback.',
      )
    calendarVersion = snapshot.data
  }
  const available = await openings(input, ctx, db)
  if (!available.times.includes(input.start_time))
    throw new CallerInputError(
      'That opening is no longer available. Check other times.',
    )
  if (
    input.visit_type === 'residential_service' &&
    input.service &&
    available.quote
  ) {
    const source = available.quote.lsa_fee
      ? 'google_lsa'
      : input.service.lead_source
    if (!source || source === 'google_unsure')
      throw new CallerInputError(
        'Confirm the lead source and final price before booking.',
      )
    if (
      available.quote.minimum_charge_applied &&
      !input.accepted_minimum_charge
    )
      throw new CallerInputError(
        'Obtain acceptance of the quoted service minimum.',
      )
    const bookingInput = {
      supabase: db,
      customer,
      address: {
        street_1: input.street,
        street_2: input.unit,
        city: input.city,
        state: 'CO',
        zip_code: input.zip_code,
      },
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      line_items: input.service.line_items,
      booking_mode: 'direct' as const,
      booking_channel: 'ai_agent' as const,
      source_label: live
        ? 'After-hours phone (Harry)'
        : 'After-hours phone preview',
      lead_source: source,
      lead_source_detail: input.service.lead_detail,
      actor_label: live ? 'Harry' : 'After-hours phone preview',
      admin_heading: live ? 'Harry phone booking' : 'Private preview',
      accepted_minimum_charge: input.accepted_minimum_charge,
      notify_internal: Boolean(live),
      notify_customer: Boolean(live),
      sync_quickbooks: Boolean(live),
    }
    const checked = await createAiStyleBooking({
      ...bookingInput,
      preview_only: true,
    })
    if (!checked.ok)
      throw new CallerInputError(
        'Sightings could not validate the requested booking. Check the service, source, address and time or offer office follow-up.',
      )
    if (Math.abs(checked.subtotal - available.quote.subtotal) > 0.01)
      throw new CallerInputError(
        'Booking validation returned different pricing. Ask the office to review.',
      )
    if (live && requestHash) {
      if (available.quote.total !== live.confirmed_total)
        throw new CallerInputError(
          'The price changed. Requote and get the caller’s acceptance before booking.',
        )
      if (ctx.isCurrent && !(await ctx.isCurrent()))
        throw new CallerInputError(
          'The caller interrupted or corrected the request. Confirm the latest details.',
        )
      const result = await commitPlannedBooking(
        bookingInput,
        {
          ...checked,
          total: available.quote.total,
          discount_applied: available.quote.coupon.amount,
        },
        null,
        {
          callSid: ctx.callSid,
          requestHash,
          calendarVersion,
          verifiedCustomerId: live.customer_ref,
          verifiedServiceAddressId: live.service_address_ref,
          useSavedEmail: live.use_saved_email === true,
          coupon: available.quote.coupon.applied
            ? available.quote.coupon.code
            : null,
          serviceSubtotal: available.quote.service_subtotal,
          deferEffects: after,
          expectedCallerSequence: ctx.expectedCallerSequence,
        },
      )
      if (
        result.status !== 'booked' ||
        !result.appointment_id ||
        !result.confirmation_number ||
        result.appointment_date !== input.appointment_date ||
        result.start_time?.slice(0, 5) !== input.start_time ||
        Number(result.total) !== live.confirmed_total
      )
        throw new CallerInputError(
          'Could not verify an exact booking receipt. Ask the office to review.',
        )
      return {
        status: 'booked',
        appointment_id: result.appointment_id,
        confirmation_number: result.confirmation_number,
        date: result.appointment_date,
        time: result.start_time.slice(0, 5),
        total: Number(result.total),
      }
    }
  }
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
      case 'phone_usual_address':
        return await proposeUsualAddress(
          ctx.callerPhone,
          usualAddressSchema.parse(args),
          db,
        )
      case 'phone_caller_lookup':
        return await lookupPhoneCaller(
          ctx.callerPhone,
          callerLookupSchema.parse(args),
          db,
        )
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
      case 'phone_book_service':
      case 'phone_preview_booking': {
        const isLive = name === 'phone_book_service'
        if (ctx.preview === isLive)
          throw new CallerInputError('Booking mode does not match this call.')
        const parsed = isLive
          ? liveBookingSchema.parse(args)
          : contactSchema.parse(args)
        if (!parsed.customer_confirmed)
          throw new CallerInputError(
            'Read back the exact visit and get confirmation first.',
          )
        const resolved = await resolveContact(parsed, ctx, db)
        if (
          resolved.verifiedCustomer &&
          parsed.service?.zip_code &&
          parsed.service.zip_code !== resolved.zip_code
        )
          throw new CallerInputError(
            'The quoted ZIP differs from the verified service address. Recheck the location and quote.',
          )
        const input = {
          ...resolved,
          service: resolved.service && {
            ...resolved.service,
            zip_code: resolved.verifiedCustomer
              ? resolved.zip_code
              : resolved.service.zip_code,
            lead_source:
              resolved.service.lead_source ??
              resolved.lead_source ??
              (resolved.verifiedCustomer ? 'repeat_customer' : undefined),
            lead_detail: resolved.service.lead_detail ?? resolved.lead_detail,
          },
        }
        return await checkOrBook(
          bookingSchema.parse(input),
          ctx,
          db,
          isLive ? liveBookingSchema.parse(input) : undefined,
        )
      }
      case 'phone_book_measurement': {
        if (ctx.preview)
          throw new CallerInputError(
            'Measurement writes are unavailable for a test call.',
          )
        const parsed = measurementSchema.parse(args)
        if (!parsed.customer_confirmed)
          throw new CallerInputError(
            'Get confirmation of the measuring visit before saving it.',
          )
        const input = await resolveContact(parsed, ctx, db)
        if (ctx.isCurrent && !(await ctx.isCurrent()))
          throw new CallerInputError('Confirm the caller’s latest request.')
        return await bookPhoneMeasurement({
          db,
          callSid: ctx.callSid,
          callerPhone: ctx.callerPhone,
          customer: {
            first_name: input.first_name,
            last_name: input.last_name,
            email: input.email,
          },
          address: {
            street_1: input.street,
            street_2: input.unit,
            city: input.city,
            state: 'CO',
            zip_code: input.zip_code,
          },
          appointmentDate: input.appointment_date,
          startTime: input.start_time,
          businessName: input.business_name,
          savedContact:
            input.verifiedCustomer &&
            input.customer_ref &&
            input.service_address_ref
              ? {
                  customerId: input.customer_ref,
                  addressId: input.service_address_ref,
                  useSavedEmail: input.use_saved_email === true,
                }
              : undefined,
          jobDescription: input.job_description,
          leadSource: input.lead_source,
          leadDetail: input.lead_detail,
          isCurrent: ctx.isCurrent,
          expectedCallerSequence: ctx.expectedCallerSequence,
        })
      }
      case 'phone_preview_change':
        return await previewChange(changeSchema.parse(args), ctx, db)
      default:
        return { error: 'Unknown phone tool.' }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fields = error.issues.map((issue) => issue.path.join('.'))
      console.warn('[Phone assistant] Invalid tool arguments', {
        callSid: ctx.callSid,
        tool: name,
        fields,
      })
      return { error: 'Required details are missing or invalid.', fields }
    }
    if (error instanceof CallerInputError) {
      console.warn('[Phone assistant] Customer request needs follow-up', {
        callSid: ctx.callSid,
        tool: name,
        reason: error.message,
      })
      return { error: error.message }
    }
    console.error('[Phone assistant] Could not verify tool request', {
      callSid: ctx.callSid,
      tool: name,
    })
    return { error: 'Could not verify that request. Offer to take a message.' }
  }
}
