import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  calendarEventsToAppointmentWindows,
  getAvailableSlots,
  type AvailabilityTemplate,
  type AvailabilityOverride,
  type ExistingAppointmentWindow,
  type CalendarEventWindow,
} from '@/lib/ops/availability'
import { normalizeOpsPhone } from '@/lib/ops/phone'
import { queueGeocodeForStoredAddress } from '@/lib/ops/forward-geocode'

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const phone = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) => /^(?:\+?[1-9]\d{9,14})$/.test(value.replace(/[\s().-]/g, '')),
    'A valid contact phone is required',
  )
  .transform(normalizeOpsPhone)
const site = z
  .object({
    street_1: z.string().trim().min(1).max(300),
    street_2: z.string().trim().max(300).default(''),
    city: z.string().trim().min(1).max(150),
    state: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/)
      .default('CO'),
    zip_code: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/),
  })
  .strict()
const identity = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('existing'),
      customer_id: z.uuid(),
      service_address_id: z.uuid(),
    })
    .strict(),
  z
    .object({ mode: z.literal('new_site'), customer_id: z.uuid(), site })
    .strict(),
  z
    .object({
      mode: z.literal('new_customer'),
      customer: z
        .object({
          business_name: z.string().trim().min(1).max(300),
          contact_name: z.string().trim().min(1).max(200),
          email: z
            .email()
            .max(320)
            .transform((value) => value.toLowerCase())
            .optional(),
          phone,
        })
        .strict(),
      site,
    })
    .strict(),
])
export const measurementInputSchema = z
  .object({
    operation_key: z.uuid(),
    account_id: z.uuid(),
    identity,
    appointment_date: z.iso.date(),
    start_time: clock,
    assigned_staff_user_id: z.uuid(),
    visit_duration_minutes: z.number().int().min(15).max(180).default(60),
    job_description: z.string().trim().min(1).max(5000),
  })
  .strict()
export type MeasurementInput = z.infer<typeof measurementInputSchema>
export const bridgeActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('match'),
      email: z.email().optional(),
      phone: z.string().trim().min(3).max(40).optional(),
      customer_id: z.uuid().optional(),
    })
    .strict()
    .refine(
      (input) => input.email || input.phone || input.customer_id,
      'Provide an email, phone, or customer ID',
    ),
  z
    .object({
      action: z.literal('slots'),
      appointment_date: z.iso.date(),
      visit_duration_minutes: z.number().int().min(15).max(180).default(60),
      assigned_staff_user_id: z.uuid().optional(),
    })
    .strict(),
  measurementInputSchema.extend({ action: z.literal('preview') }),
  z
    .object({
      action: z.literal('confirm'),
      operation_key: z.uuid(),
      preview_token: z.string().min(1).max(32000),
    })
    .strict(),
  z.object({ action: z.literal('status'), operation_key: z.uuid() }).strict(),
])
export class MeasurementError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: unknown,
  ) {
    super(message)
  }
}
export function bridgeAuthorized(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer '))
    return false
  const actual = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function signature(body: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`outreach-measurement-v1.${body}`)
    .digest('base64url')
}
export function signMeasurementPreview(
  input: MeasurementInput,
  version: string,
  secret: string,
  now = Date.now(),
) {
  const expires = now + 10 * 60_000
  const body = Buffer.from(
    JSON.stringify({ input, version, expires }),
  ).toString('base64url')
  return {
    preview_token: `${body}.${signature(body, secret)}`,
    expires_at: new Date(expires).toISOString(),
  }
}
export function readMeasurementPreview(
  token: string,
  operationKey: string,
  secret: string,
) {
  const parts = token.split('.')
  if (
    parts.length !== 2 ||
    !bridgeAuthorized(`Bearer ${parts[1]}`, signature(parts[0], secret))
  )
    throw new MeasurementError(
      'INVALID_PREVIEW',
      'Preview could not be verified',
      400,
    )
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
  } catch {
    throw new MeasurementError(
      'INVALID_PREVIEW',
      'Preview could not be verified',
      400,
    )
  }
  const value = z
    .object({
      input: measurementInputSchema,
      version: z.string().regex(/^[a-f0-9]{64}$/),
      expires: z.number().int().positive(),
    })
    .strict()
    .parse(parsed)
  if (value.input.operation_key !== operationKey)
    throw new MeasurementError(
      'INVALID_PREVIEW',
      'Operation does not match preview',
      400,
    )
  return value
}
type Customer = {
  id: string
  business_name: string | null
  full_name: string
  email: string | null
  phone: string
  updated_at?: string
}
type Site = {
  id: string
  customer_id: string
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  updated_at?: string
}
type Staff = {
  id: string
  user_id: string | null
  display_name: string
  default_open: boolean
  scheduling_priority: number
}
export type MeasurementContext = {
  customers: Customer[]
  sites: Site[]
  staff: Staff[]
  daily: { staff_user_id: string; is_open: boolean }[]
  templates: (AvailabilityTemplate & { staff_user_id: string | null })[]
  overrides: (AvailabilityOverride & { staff_user_id: string | null })[]
  appointments: (ExistingAppointmentWindow & {
    assigned_staff_user_id: string | null
  })[]
  events: (CalendarEventWindow & { assigned_staff_user_id: string | null })[]
  blacklisted: boolean
}
function denverClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (name: string) => parts.find((part) => part.type === name)!.value
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}
function assertDate(date: string, now: Date) {
  const today = denverClock(now).date
  if (
    date < today ||
    new Date(`${date}T12:00:00Z`).getTime() > now.getTime() + 366 * 86400_000
  )
    throw new MeasurementError(
      'INVALID_DATE',
      'Choose a date within the coming year',
      400,
    )
}
export function measurementSlots(
  context: MeasurementContext,
  date: string,
  visitMinutes: number,
  staffId?: string,
  now = new Date(),
) {
  assertDate(date, now)
  const local = denverClock(now)
  const requiredMinutes = Math.min(240, visitMinutes + 60)
  const staff = context.staff
    .filter(
      (member) =>
        (!staffId || staffId === member.id) &&
        (context.daily.find((row) => row.staff_user_id === member.id)
          ?.is_open ??
          member.default_open),
    )
    .map((member) => {
      const eligible = context.templates.filter(
        (template) =>
          !template.staff_user_id || template.staff_user_id === member.id,
      )
      const specific = eligible.filter(
        (template) => template.staff_user_id === member.id,
      )
      const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay()
      const templates = (specific.length ? specific : eligible).filter(
        (template) => template.day_of_week === dayOfWeek,
      )
      // Never auto-seed defaults or hide a configuration-read failure in a bridge.
      const slots = templates.length
        ? getAvailableSlots({
            date,
            requiredMinutes,
            templates,
            overrides: context.overrides.filter(
              (row) => !row.staff_user_id || row.staff_user_id === member.id,
            ),
            appointments: [
              ...context.appointments
                .filter(
                  (row) =>
                    !row.assigned_staff_user_id ||
                    row.assigned_staff_user_id === member.id,
                )
                .map((row) => ({
                  ...row,
                  status:
                    row.status === 'pending_approval' ? 'booked' : row.status,
                })),
              ...calendarEventsToAppointmentWindows(
                date,
                context.events.filter(
                  (row) =>
                    !row.assigned_staff_user_id ||
                    row.assigned_staff_user_id === member.id ||
                    row.assigned_staff_user_id === member.user_id,
                ),
              ),
            ],
            minStartMinutes:
              date === local.date ? local.minutes + 1 : undefined,
            maxResults: 48,
          })
        : []
      return {
        staff_user_id: member.id,
        staff_name: member.display_name,
        slots: slots.map((slot) => ({
          start_time: slot.start_time.slice(0, 5),
          end_time: slot.end_time.slice(0, 5),
        })),
      }
    })
  return {
    timezone: 'America/Denver' as const,
    visit_duration_minutes: visitMinutes,
    calendar_duration_minutes: requiredMinutes,
    staff,
  }
}
function safeCustomer(customer: Customer) {
  return {
    id: customer.id,
    business_name: customer.business_name,
    full_name: customer.full_name,
    email: customer.email,
    phone: customer.phone,
  }
}
export function measurementPlan(
  input: MeasurementInput,
  context: MeasurementContext,
  now = new Date(),
) {
  if (context.blacklisted)
    throw new MeasurementError(
      'CUSTOMER_BLOCKED',
      'This customer is blacklisted in Sightings',
    )
  const selected = input.identity
  let customer: {
    id: string | null
    business_name: string | null
    full_name: string
    email: string | null
    phone: string
  }
  if (selected.mode === 'new_customer') {
    if (context.customers.length)
      throw new MeasurementError(
        'MATCH_REQUIRES_SELECTION',
        'Select an existing matching customer explicitly',
        409,
        { candidates: context.customers.map(safeCustomer) },
      )
    customer = {
      id: null,
      business_name: selected.customer.business_name,
      full_name: selected.customer.contact_name,
      email: selected.customer.email || null,
      phone: selected.customer.phone,
    }
  } else {
    const found = context.customers.find(
      (row) => row.id === selected.customer_id,
    )
    if (!found)
      throw new MeasurementError(
        'CUSTOMER_MISSING',
        'Selected customer no longer exists',
      )
    if (!phone.safeParse(found.phone).success)
      throw new MeasurementError(
        'CONTACT_REQUIRED',
        'Save a valid contact phone in Sightings before scheduling',
      )
    customer = safeCustomer(found)
  }
  let address: Omit<Site, 'updated_at'> | z.infer<typeof site>
  if (selected.mode === 'existing') {
    const found = context.sites.find(
      (row) =>
        row.id === selected.service_address_id &&
        row.customer_id === selected.customer_id,
    )
    if (!found)
      throw new MeasurementError(
        'SITE_MISMATCH',
        'Selected site does not belong to this customer',
      )
    if (
      !site.safeParse({
        street_1: found.street_1,
        street_2: found.street_2 || '',
        city: found.city,
        state: found.state,
        zip_code: found.zip_code,
      }).success
    )
      throw new MeasurementError(
        'SITE_INCOMPLETE',
        'Complete the saved site address in Sightings before scheduling',
      )
    address = {
      id: found.id,
      customer_id: found.customer_id,
      street_1: found.street_1,
      street_2: found.street_2,
      city: found.city,
      state: found.state,
      zip_code: found.zip_code,
    }
  } else {
    if (
      context.sites.some(
        (row) =>
          row.street_1.trim().toLowerCase() ===
            selected.site.street_1.toLowerCase() &&
          (row.street_2 || '').trim().toLowerCase() ===
            selected.site.street_2.toLowerCase() &&
          row.zip_code === selected.site.zip_code,
      )
    )
      throw new MeasurementError(
        'SITE_REQUIRES_SELECTION',
        'Select the existing saved site explicitly',
      )
    address = selected.site
  }
  const available = measurementSlots(
    context,
    input.appointment_date,
    input.visit_duration_minutes,
    input.assigned_staff_user_id,
    now,
  )
  const member = available.staff.find(
    (row) => row.staff_user_id === input.assigned_staff_user_id,
  )
  const slot = member?.slots.find((row) => row.start_time === input.start_time)
  if (!slot)
    throw new MeasurementError(
      'SLOT_UNAVAILABLE',
      'That technician and measuring time are no longer available; choose a live opening',
    )
  return {
    ...input,
    customer,
    site: address,
    end_time: slot.end_time,
    staff_name: member!.staff_name,
    calendar_duration_minutes: available.calendar_duration_minutes,
    effects: {
      appointment_kind: 'estimate' as const,
      invoice: false,
      email: false,
      sms: false,
      staff_notifications: false,
    },
  }
}
async function contextFor(
  db: SupabaseClient,
  date: string,
  selectedIdentity: unknown,
) {
  const { data, error } = await db.rpc('preview_outreach_measurement_context', {
    p_date: date,
    p_identity: selectedIdentity,
  })
  if (error || !data?.context || !data?.version)
    throw new MeasurementError(
      'CONTEXT_UNAVAILABLE',
      'Sightings could not verify calendar and account data',
      503,
    )
  return data as { context: MeasurementContext; version: string }
}
export async function measurementStatus(db: SupabaseClient, key: string) {
  const { data, error } = await db
    .from('outreach_measurement_receipts')
    .select('status,receipt,request,code,error')
    .eq('operation_key', key)
    .maybeSingle()
  if (error)
    throw new MeasurementError(
      'STATUS_UNAVAILABLE',
      'Could not check the saved operation; do not create a replacement booking',
      503,
    )
  return data
}
function savedOutcome(saved: {
  status: string
  receipt: unknown
  code?: string | null
  error?: string | null
}) {
  return saved.status === 'confirmed'
    ? { status: 'confirmed', receipt: saved.receipt }
    : {
        status: 'rejected',
        receipt: null,
        code: saved.code,
        error: saved.error,
        definitive: true,
      }
}
export async function handleMeasurementAction(
  db: SupabaseClient,
  action: z.infer<typeof bridgeActionSchema>,
  secret: string,
  writesEnabled: boolean,
) {
  if (action.action === 'status') {
    const saved = await measurementStatus(db, action.operation_key)
    return saved ? savedOutcome(saved) : { status: 'not_found', receipt: null }
  }
  if (action.action === 'match') {
    // Match only a supplied identity; never enumerate recent business records.
    const selectedIdentity = action.customer_id
      ? { mode: 'existing', customer_id: action.customer_id }
      : {
          mode: 'new_customer',
          customer: { email: action.email, phone: action.phone },
        }
    const { context } = await contextFor(
      db,
      denverClock(new Date()).date,
      selectedIdentity,
    )
    const candidates = await Promise.all(
      context.customers.map(async (customer) => {
        const { data, error } = await db
          .from('ops_service_addresses')
          .select('id,street_1,street_2,city,state,zip_code')
          .eq('customer_id', customer.id)
          .order('id')
          .limit(101)
        if (error)
          throw new MeasurementError(
            'CONTEXT_UNAVAILABLE',
            'Could not load saved sites',
            503,
          )
        return {
          ...safeCustomer(customer),
          sites: (data || []).slice(0, 100),
          sites_truncated: (data || []).length > 100,
        }
      }),
    )
    return { candidates, truncated: candidates.length > 20 }
  }
  if (action.action === 'slots') {
    const { context } = await contextFor(db, action.appointment_date, {})
    return measurementSlots(
      context,
      action.appointment_date,
      action.visit_duration_minutes,
      action.assigned_staff_user_id,
    )
  }
  if (action.action === 'preview') {
    const { action: _action, ...rawInput } = action
    const input = measurementInputSchema.parse(rawInput)
    const saved = await measurementStatus(db, input.operation_key)
    if (saved) {
      if (
        JSON.stringify(measurementInputSchema.parse(saved.request)) !==
        JSON.stringify(input)
      )
        throw new MeasurementError(
          'OPERATION_EXISTS',
          'This operation is already confirmed; recover its receipt',
        )
      return savedOutcome(saved)
    }
    const { context, version } = await contextFor(
      db,
      input.appointment_date,
      input.identity,
    )
    return {
      ...signMeasurementPreview(input, version, secret),
      preview: measurementPlan(input, context),
    }
  }
  const token = readMeasurementPreview(
    action.preview_token,
    action.operation_key,
    secret,
  )
  const saved = await measurementStatus(db, action.operation_key)
  if (saved) {
    // JSONB key ordering differs from JSON.stringify; compare parsed schema order.
    if (
      JSON.stringify(measurementInputSchema.parse(saved.request)) !==
      JSON.stringify(token.input)
    )
      throw new MeasurementError(
        'OPERATION_EXISTS',
        'Operation belongs to different booking details',
      )
    return savedOutcome(saved)
  }
  const { data, error } = await db.rpc('confirm_outreach_measurement', {
    p_input: token.input,
    p_expected_version: token.version,
    p_expires_at: new Date(token.expires).toISOString(),
    p_writes_enabled: writesEnabled,
  })
  if (error) {
    const recovered = await measurementStatus(db, action.operation_key)
    if (recovered) {
      if (
        JSON.stringify(measurementInputSchema.parse(recovered.request)) !==
        JSON.stringify(token.input)
      )
        throw new MeasurementError(
          'OPERATION_EXISTS',
          'Operation belongs to different booking details',
        )
      return savedOutcome(recovered)
    }
    throw new MeasurementError(
      'CONFIRM_UNCERTAIN',
      'Sightings could not return a definitive result. Recover this operation status before retrying',
      503,
    )
  }
  if (
    data?.status === 'confirmed' &&
    token.input.identity.mode !== 'existing'
  ) {
    try {
      await queueGeocodeForStoredAddress(db, data.receipt.service_address_id)
    } catch {
      // The booking already committed. A map lookup failure never invites a
      // duplicate booking or changes the durable receipt to a failed result.
      console.error('[outreach/measurements] Saved site lookup needs review')
    }
  }
  return data
}
