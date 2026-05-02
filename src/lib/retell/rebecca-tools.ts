import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  timeToMinutes,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'
import { createAiStyleBooking } from '@/lib/ops/create-ai-style-booking'
import { createAiStyleEstimate } from '@/lib/ops/create-ai-style-estimate'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { sendAdminSMS } from '@/lib/twilio'
import { sendTelegramNotification } from '@/lib/telegram'
import { REBECCA_RETELL_CONFIG } from '@/lib/retell/rebecca-config'
import { Resend } from 'resend'
import type {
  RebeccaAddressArgs,
  RebeccaCustomerArgs,
  RetellFunctionName,
  RetellFunctionResponse,
} from '@/lib/retell/rebecca-types'

type RebeccaToolContext = {
  supabase: SupabaseClient
  callId?: string
  callerPhone?: string
}

type BookingLineItemInput = {
  service_id?: string
  catalog_item_id?: string
  catalog_slug?: string
  service_name?: string
  quantity?: number
}

type PriorAppointmentRow = {
  id: string
  customer_id: string
  service_address_id: string
  appointment_date: string
  start_time: string
  end_time: string
  status: string
  quoted_total: number | null
  source: string | null
  lead_source: string | null
  ops_customers:
    | {
        id: string
        full_name: string | null
        first_name: string | null
        last_name: string | null
        email: string | null
        phone: string | null
      }
    | Array<{
        id: string
        full_name: string | null
        first_name: string | null
        last_name: string | null
        email: string | null
        phone: string | null
      }>
    | null
  ops_service_addresses:
    | {
        id: string
        street_1: string | null
        street_2: string | null
        city: string | null
        state: string | null
        zip_code: string | null
      }
    | Array<{
        id: string
        street_1: string | null
        street_2: string | null
        city: string | null
        state: string | null
        zip_code: string | null
      }>
    | null
  ops_appointment_line_items: Array<{
    name_snapshot: string | null
    quantity: number | null
    duration_minutes: number | null
    line_total: number | null
  }> | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = (hours || 0) * 60 + (minutes || 0) + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(
    normalized % 60,
  ).padStart(2, '0')}:00`
}

function todayIsoDate(): string {
  return businessDateParts().iso
}

function daysAgoIsoDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function normalizeLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function catalogSearchTerm(value: string): string {
  return value.replace(/[%,]/g, ' ').trim()
}

function businessDateParts(date = new Date()): {
  iso: string
  year: number
  month: number
  day: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value || ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))

  return {
    iso: `${String(year).padStart(4, '0')}-${String(month).padStart(
      2,
      '0',
    )}-${String(day).padStart(2, '0')}`,
    year,
    month,
    day,
  }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const [, year, month, day] = match
  const parsed = new Date(`${value}T12:00:00Z`)
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  )
}

function normalizeRequestedDate(value: string):
  | {
      ok: true
      date: string
      normalizedFrom?: string
    }
  | {
      ok: false
      message: string
    } {
  const today = businessDateParts()
  if (!isValidIsoDate(value)) {
    return {
      ok: false,
      message: `date must be a real date in YYYY-MM-DD format. Today's date is ${today.iso} in America/Denver. Ask the caller for the appointment date again if needed.`,
    }
  }

  const [, inputYear, inputMonth, inputDay] =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) || []
  let normalized = value

  if (Number(inputYear) < today.year) {
    const currentYearCandidate = `${today.year}-${inputMonth}-${inputDay}`
    normalized =
      currentYearCandidate >= today.iso
        ? currentYearCandidate
        : `${today.year + 1}-${inputMonth}-${inputDay}`
  }

  if (normalized < today.iso) {
    return {
      ok: false,
      message: `The requested appointment date ${value} is in the past. Today's date is ${today.iso} in America/Denver. Ask the caller for a future appointment date.`,
    }
  }

  return {
    ok: true,
    date: normalized,
    ...(normalized === value ? {} : { normalizedFrom: value }),
  }
}

function splitCustomerName(name: string): {
  firstName: string
  lastName: string
} {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : 'Unknown',
  }
}

function parseAddressString(value: string): RebeccaAddressArgs {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const street1 = parts[0] || value.trim()
  const city = parts[1] || ''
  const stateZip = parts.slice(2).join(' ')
  const zipMatch = /\b(\d{5}(?:-\d{4})?)\b/.exec(stateZip)
  const stateMatch = /\b([A-Za-z]{2}|Colorado|Colo\.?)\b/i.exec(stateZip)
  const stateValue = stateMatch?.[1] || ''

  return {
    street_1: street1,
    city,
    state: /^co(?:lorado|lo\.?)?$/i.test(stateValue)
      ? 'CO'
      : stateValue.toUpperCase() || 'CO',
    zip_code: zipMatch?.[1] || '',
  }
}

function response(
  success: boolean,
  message: string,
  data?: unknown,
): RetellFunctionResponse {
  return { success, message, ...(data === undefined ? {} : { data }) }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function contactLine(label: string, value: string): string {
  return `${label}: ${value || 'Not provided'}`
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

async function loadAvailabilityBundle(
  supabase: SupabaseClient,
  date: string,
): Promise<{
  templates: Parameters<typeof getAvailableSlots>[0]['templates']
  overrides: Parameters<typeof getAvailableSlots>[0]['overrides']
  appointments: ExistingAppointmentWindow[]
}> {
  const [templatesResult, overridesResult, appointmentsResult] =
    await Promise.all([
      supabase.from('availability_templates').select('*').eq('is_active', true),
      supabase
        .from('availability_overrides')
        .select('*')
        .eq('override_date', date),
      supabase
        .from('ops_appointments')
        .select('appointment_date, start_time, end_time, status')
        .eq('appointment_date', date),
    ])

  if (templatesResult.error) throw templatesResult.error
  if (overridesResult.error) throw overridesResult.error
  if (appointmentsResult.error) throw appointmentsResult.error

  return {
    templates:
      templatesResult.data && templatesResult.data.length > 0
        ? templatesResult.data
        : DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
    overrides: overridesResult.data || [],
    appointments: (appointmentsResult.data ||
      []) as ExistingAppointmentWindow[],
  }
}

async function getServiceCatalog(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const category = stringArg(args, 'category')
  const term = catalogSearchTerm(category)

  let query = context.supabase
    .from('service_catalog_items')
    .select(
      'id, name, slug, category, description, base_price, pricing_unit, default_duration_minutes, sort_order',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })

  if (term) {
    query = query.or(
      `category.ilike.%${term}%,name.ilike.%${term}%,slug.ilike.%${term}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error

  return response(true, 'Loaded active service catalog.', {
    services: data || [],
  })
}

async function getCalendarSlots(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedDate = stringArg(args, 'date')
  const normalizedDate = normalizeRequestedDate(requestedDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const date = normalizedDate.date

  const durationMinutes = numberArg(args, 'duration_minutes')
  const totalDollars = numberArg(args, 'total_dollars')
  const requiredMinutes =
    durationMinutes && durationMinutes > 0
      ? durationMinutes
      : calculateAppointmentDurationFromTotal(totalDollars || 0)

  const bundle = await loadAvailabilityBundle(context.supabase, date)
  const slots = getAvailableSlots({
    date,
    requiredMinutes: applyAppointmentBuffer(requiredMinutes),
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })

  return response(true, `Found ${slots.length} available slots.`, {
    date,
    ...(normalizedDate.normalizedFrom
      ? { normalized_from_date: normalizedDate.normalizedFrom }
      : {}),
    required_minutes: applyAppointmentBuffer(requiredMinutes),
    slots,
  })
}

async function findRecentCompletedAppointments(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<PriorAppointmentRow[]> {
  const lookupPhone =
    stringArg(args, 'lookup_phone') ||
    stringArg(asRecord(args.customer), 'phone') ||
    context.callerPhone ||
    ''
  const variants = opsPhoneLookupVariants(lookupPhone)

  if (variants.length === 0) return []

  const { data: customers, error: customerError } = await context.supabase
    .from('ops_customers')
    .select('id')
    .in('phone', variants)
    .limit(10)

  if (customerError) throw customerError
  const customerIds = (customers || []).map((customer) => customer.id)
  if (customerIds.length === 0) return []

  const lookbackDays = Math.max(
    1,
    Math.min(numberArg(args, 'lookback_days') || 30, 90),
  )
  const status = stringArg(args, 'appointment_status') || 'completed'
  const { data, error } = await context.supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      quoted_total,
      source,
      lead_source,
      ops_customers!ops_appointments_customer_id_fkey (
        id,
        full_name,
        first_name,
        last_name,
        email,
        phone
      ),
      ops_service_addresses (
        id,
        street_1,
        street_2,
        city,
        state,
        zip_code
      ),
      ops_appointment_line_items (
        name_snapshot,
        quantity,
        duration_minutes,
        line_total
      )
    `,
    )
    .in('customer_id', customerIds)
    .eq('status', status)
    .gte('appointment_date', daysAgoIsoDate(lookbackDays))
    .lte('appointment_date', todayIsoDate())
    .order('appointment_date', { ascending: false })
    .order('start_time', { ascending: false })
    .limit(5)

  if (error) throw error
  return (data || []) as PriorAppointmentRow[]
}

function appointmentSummary(row: PriorAppointmentRow) {
  const customer = firstRelated(row.ops_customers)
  const address = firstRelated(row.ops_service_addresses)
  return {
    id: row.id,
    appointment_date: row.appointment_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    customer_name:
      customer?.full_name ||
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
      null,
    customer_phone: customer?.phone || null,
    customer_email: customer?.email || null,
    address: address
      ? {
          id: address.id,
          street_1: address.street_1,
          street_2: address.street_2,
          city: address.city,
          state: address.state,
          zip_code: address.zip_code,
        }
      : null,
    services: (row.ops_appointment_line_items || []).map((item) => ({
      name: item.name_snapshot,
      quantity: item.quantity,
      duration_minutes: item.duration_minutes,
      line_total: item.line_total,
    })),
    quoted_total: row.quoted_total,
  }
}

async function listCallerAppointments(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const appointments = await findRecentCompletedAppointments(args, context)
  if (appointments.length === 0) {
    return response(
      false,
      'No completed appointment from the last 30 days was found for this caller. Collect details and notify admin.',
      { appointments: [] },
    )
  }

  const summaries = appointments.map(appointmentSummary)
  return response(
    true,
    `Found ${appointments.length} completed appointment${appointments.length === 1 ? '' : 's'} from the last 30 days. Use the most recent one unless the caller corrects you.`,
    {
      recommended_appointment: summaries[0],
      appointments: summaries,
    },
  )
}

async function resolveBookingLineItems(
  supabase: SupabaseClient,
  rawItems: unknown,
): Promise<Array<{ service_id: string; quantity: number }> | null> {
  if (!Array.isArray(rawItems)) return null

  const inputs = rawItems.map((item) => asRecord(item) as BookingLineItemInput)
  const directIds = inputs
    .map((item) => item.service_id || item.catalog_item_id)
    .filter(Boolean) as string[]
  const slugs = inputs
    .filter((item) => !item.service_id && !item.catalog_item_id)
    .map((item) => item.catalog_slug)
    .filter(Boolean) as string[]
  const names = inputs
    .filter((item) => !item.service_id && !item.catalog_item_id)
    .map((item) => item.service_name)
    .filter(Boolean) as string[]

  let slugToId = new Map<string, string>()
  if (slugs.length > 0) {
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('id, slug')
      .in('slug', slugs)
      .eq('is_active', true)
    if (error) throw error
    slugToId = new Map((data || []).map((row) => [String(row.slug), row.id]))
  }

  let nameToId = new Map<string, string>()
  if (names.length > 0) {
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select('id, name, slug')
      .eq('is_active', true)
    if (error) throw error
    nameToId = new Map(
      (data || []).flatMap((row) => [
        [normalizeLookup(String(row.name || '')), row.id],
        [normalizeLookup(String(row.slug || '')), row.id],
      ]),
    )
  }

  const resolved = inputs
    .map((item) => {
      const serviceId =
        item.service_id ||
        item.catalog_item_id ||
        (item.catalog_slug ? slugToId.get(item.catalog_slug) : undefined) ||
        (item.service_name
          ? nameToId.get(normalizeLookup(item.service_name))
          : undefined)
      if (!serviceId) return null
      return {
        service_id: serviceId,
        quantity: Math.max(1, Math.round(Number(item.quantity || 1))),
      }
    })
    .filter(Boolean) as Array<{ service_id: string; quantity: number }>

  return resolved.length > 0 || directIds.length > 0 || names.length > 0
    ? resolved
    : null
}

async function validateRequestedSlotAvailable(
  supabase: SupabaseClient,
  params: {
    appointmentDate: string
    startTime: string
    lineItems: Array<{ service_id: string; quantity: number }>
  },
): Promise<{ ok: true } | { ok: false; message: string; slots: unknown[] }> {
  const normalizedDate = normalizeRequestedDate(params.appointmentDate)
  if (!normalizedDate.ok) {
    return { ok: false, message: normalizedDate.message, slots: [] }
  }
  const normalizedStart =
    params.startTime.length === 5 ? `${params.startTime}:00` : params.startTime
  const serviceIds = params.lineItems.map((item) => item.service_id)
  const { data, error } = await supabase
    .from('service_catalog_items')
    .select('id, base_price')
    .in('id', serviceIds)
    .eq('is_active', true)

  if (error) throw error

  const catalogById = new Map((data || []).map((item) => [item.id, item]))
  const subtotal = params.lineItems.reduce((sum, item) => {
    const catalogItem = catalogById.get(item.service_id)
    return sum + Number(catalogItem?.base_price || 0) * item.quantity
  }, 0)
  const requiredMinutes = applyAppointmentBuffer(
    calculateAppointmentDurationFromTotal(subtotal),
  )
  const bundle = await loadAvailabilityBundle(supabase, normalizedDate.date)
  const slots = getAvailableSlots({
    date: normalizedDate.date,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })
  const requestedStartMinutes = timeToMinutes(normalizedStart)
  const requestedSlot = slots.find(
    (slot) => timeToMinutes(slot.start_time) === requestedStartMinutes,
  )

  if (requestedSlot) return { ok: true }

  return {
    ok: false,
    message:
      'That appointment time is no longer available. Offer one of the returned available slots instead and do not say the customer is booked.',
    slots,
  }
}

function customerArgs(args: Record<string, unknown>): RebeccaCustomerArgs {
  const customer = asRecord(args.customer)
  const fullName = stringArg(customer, 'name') || stringArg(args, 'name')
  const parsedName = splitCustomerName(fullName)
  return {
    first_name:
      stringArg(customer, 'first_name') ||
      stringArg(args, 'first_name') ||
      parsedName.firstName,
    last_name:
      stringArg(customer, 'last_name') ||
      stringArg(args, 'last_name') ||
      parsedName.lastName,
    email: stringArg(customer, 'email') || stringArg(args, 'email'),
    phone: stringArg(customer, 'phone') || stringArg(args, 'phone'),
    business_name:
      stringArg(customer, 'business_name') ||
      stringArg(args, 'business_name') ||
      null,
  }
}

function addressArgs(args: Record<string, unknown>): RebeccaAddressArgs {
  if (typeof args.address === 'string') {
    return parseAddressString(args.address)
  }

  const address = asRecord(args.address)
  return {
    street_1: stringArg(address, 'street_1') || stringArg(args, 'street_1'),
    city: stringArg(address, 'city') || stringArg(args, 'city'),
    state: stringArg(address, 'state') || stringArg(args, 'state') || 'CO',
    zip_code: stringArg(address, 'zip_code') || stringArg(args, 'zip_code'),
  }
}

async function createBooking(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const lineItems = await resolveBookingLineItems(
    context.supabase,
    args.line_items,
  )
  if (!lineItems) {
    return response(false, 'At least one valid line item is required.')
  }

  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const appointmentDate = normalizedDate.date
  const startTime = stringArg(args, 'start_time')
  const slotCheck = await validateRequestedSlotAvailable(context.supabase, {
    appointmentDate,
    startTime,
    lineItems,
  })
  if (!slotCheck.ok) {
    return response(false, slotCheck.message, {
      appointment_date: appointmentDate,
      requested_start_time: startTime,
      available_slots: slotCheck.slots,
    })
  }

  const result = await createAiStyleBooking({
    supabase: context.supabase,
    customer: customerArgs(args),
    address: addressArgs(args),
    appointment_date: appointmentDate,
    start_time: startTime,
    line_items: lineItems,
    booking_mode: 'direct',
    booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
    source_label: REBECCA_RETELL_CONFIG.sourceLabel,
    lead_source: 'retell_rabecca',
    actor_label: REBECCA_RETELL_CONFIG.actorLabel,
    admin_heading: REBECCA_RETELL_CONFIG.adminHeading,
  })

  if (!result.ok) {
    return response(
      false,
      `Booking was NOT created: ${result.error}. Do not tell the caller they are booked. Resolve this issue or offer the returned next step.`,
    )
  }
  return response(true, result.message, result)
}

async function createEstimate(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)

  const result = await createAiStyleEstimate({
    supabase: context.supabase,
    customer: customerArgs(args),
    address: addressArgs(args),
    appointment_date: normalizedDate.date,
    start_time: stringArg(args, 'start_time'),
    visit_duration_minutes: numberArg(args, 'visit_duration_minutes') || 60,
    job_description: stringArg(args, 'job_description') || null,
    booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
    source_label: REBECCA_RETELL_CONFIG.sourceLabel,
    actor_label: REBECCA_RETELL_CONFIG.actorLabel,
    admin_heading: REBECCA_RETELL_CONFIG.estimateAdminHeading,
  })

  if (!result.ok) return response(false, result.error, result)
  return response(true, result.message, result)
}

async function scheduleReclean(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const requestedAppointmentDate = stringArg(args, 'appointment_date')
  const normalizedDate = normalizeRequestedDate(requestedAppointmentDate)
  if (!normalizedDate.ok) return response(false, normalizedDate.message)
  const appointmentDate = normalizedDate.date
  const startTime = stringArg(args, 'start_time')
  const issueSummary =
    stringArg(args, 'issue_summary') ||
    stringArg(args, 'complaint_summary') ||
    'Customer requested a reclean for a prior completed job.'
  const durationMinutes = Math.max(
    120,
    Math.min(numberArg(args, 'duration_minutes') || 120, 240),
  )

  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return response(false, 'appointment_date is required in YYYY-MM-DD format.')
  }
  if (!/^\d{1,2}:\d{2}(?::\d{2})?$/.test(startTime)) {
    return response(false, 'start_time is required in HH:MM format.')
  }

  const recentAppointments = await findRecentCompletedAppointments(
    args,
    context,
  )
  const requestedOriginalId = stringArg(args, 'original_appointment_id')
  const original =
    (requestedOriginalId
      ? recentAppointments.find(
          (appointment) => appointment.id === requestedOriginalId,
        )
      : recentAppointments[0]) || null

  if (!original) {
    return response(
      false,
      'No eligible completed appointment from the last 30 days was found for this caller. Do not schedule a reclean; notify admin instead.',
      { appointments: recentAppointments.map(appointmentSummary) },
    )
  }

  const bundle = await loadAvailabilityBundle(context.supabase, appointmentDate)
  const requiredMinutes = applyAppointmentBuffer(durationMinutes)
  const slots = getAvailableSlots({
    date: appointmentDate,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 8,
  })
  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime
  const requestedSlot = slots.find(
    (slot) => timeToMinutes(slot.start_time) === timeToMinutes(normalizedStart),
  )

  if (!requestedSlot) {
    return response(
      false,
      'That reclean time is not available. Offer one of the returned available slots instead and do not say the reclean is scheduled.',
      {
        appointment_date: appointmentDate,
        requested_start_time: startTime,
        available_slots: slots,
      },
    )
  }

  const customer = firstRelated(original.ops_customers)
  const address = firstRelated(original.ops_service_addresses)
  const customerName =
    customer?.full_name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
    'Customer'
  const internalNotes = [
    `Reclean / warranty redo scheduled by Rabecca voice AI.`,
    `Original appointment: ${original.id} on ${original.appointment_date} at ${original.start_time}.`,
    `Complaint summary: ${issueSummary}`,
    context.callId ? `Retell call ID: ${context.callId}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const { data: appointment, error: appointmentError } = await context.supabase
    .from('ops_appointments')
    .insert({
      customer_id: original.customer_id,
      service_address_id: original.service_address_id,
      booking_channel: REBECCA_RETELL_CONFIG.bookingChannel,
      source: `${REBECCA_RETELL_CONFIG.sourceLabel} - reclean`,
      lead_source: 'retell_rabecca_reclean',
      status: 'booked',
      payment_status: 'waived',
      quickbooks_sync_status: 'held',
      kind: 'service',
      appointment_date: appointmentDate,
      start_time: normalizedStart,
      end_time: addMinutesToTime(normalizedStart, requiredMinutes),
      quoted_total: 0,
      internal_notes: internalNotes,
    })
    .select('id, appointment_date, start_time, end_time')
    .single()

  if (appointmentError) throw appointmentError

  const { data: appointmentLine, error: lineError } = await context.supabase
    .from('ops_appointment_line_items')
    .insert({
      appointment_id: appointment.id,
      service_catalog_item_id: null,
      name_snapshot: 'Reclean / warranty redo',
      quantity: 1,
      unit_price: 0,
      duration_minutes: durationMinutes,
      buffer_minutes: 0,
      line_total: 0,
      notes: `Original appointment ${original.id}. ${issueSummary}`,
      pricing_unit_snapshot: 'fixed',
    })
    .select('id')
    .single()

  if (lineError) throw lineError

  const { data: invoice, error: invoiceError } = await context.supabase
    .from('ops_invoices')
    .insert({
      appointment_id: appointment.id,
      status: 'draft',
      payment_status: 'waived',
      subtotal: 0,
      discount_amount: 0,
      total: 0,
      sync_status: 'held',
    })
    .select('id')
    .single()

  if (invoiceError) throw invoiceError

  await Promise.all([
    context.supabase.from('ops_invoice_line_items').insert({
      invoice_id: invoice.id,
      appointment_line_item_id: appointmentLine.id,
      description: 'Reclean / warranty redo',
      quantity: 1,
      unit_price: 0,
      line_total: 0,
    }),
    context.supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: 'booked',
      notes: `Reclean scheduled by ${REBECCA_RETELL_CONFIG.actorLabel}`,
    }),
    context.supabase.from('ops_invoice_status_events').insert({
      invoice_id: invoice.id,
      from_status: null,
      to_status: 'draft',
      notes: `Waived reclean invoice created by ${REBECCA_RETELL_CONFIG.actorLabel}`,
    }),
    sendAdminSMS(
      `Rabecca scheduled a reclean for ${customerName} on ${appointment.appointment_date} at ${appointment.start_time}. Original appointment: ${original.id}`,
      'retell_rabecca_reclean',
    ),
  ])

  return response(true, 'Reclean appointment scheduled.', {
    appointment_id: appointment.id,
    invoice_id: invoice.id,
    original_appointment_id: original.id,
    appointment_date: appointment.appointment_date,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    customer_name: customerName,
    address: address
      ? {
          street_1: address.street_1,
          city: address.city,
          state: address.state,
          zip_code: address.zip_code,
        }
      : null,
    total: 0,
    payment_status: 'waived',
  })
}

async function notifyAdmin(
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  const message = stringArg(args, 'message')
  if (!message) return response(false, 'message is required.')

  const reason = stringArg(args, 'reason')
  const customerName = stringArg(args, 'customer_name')
  const customerPhone =
    stringArg(args, 'customer_phone') || context.callerPhone || ''
  const customerEmail = stringArg(args, 'customer_email')
  const serviceAddress = stringArg(args, 'service_address')
  const urgency = stringArg(args, 'urgency') || 'normal'
  const source = 'Rabecca voice AI'

  const details = [
    contactLine('Source', source),
    context.callId ? contactLine('Retell call ID', context.callId) : '',
    contactLine('Urgency', urgency),
    reason ? contactLine('Reason', reason) : '',
    contactLine('Customer', customerName),
    contactLine('Phone', customerPhone),
    contactLine('Email', customerEmail),
    contactLine('Address', serviceAddress),
    '',
    'Message:',
    message,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const smsMessage = `${source}${context.callId ? ` (${context.callId})` : ''}: ${
    reason ? `${reason} - ` : ''
  }${message}${customerPhone ? `\nPhone: ${customerPhone}` : ''}`

  const emailSubject = `Rabecca Alert${urgency === 'urgent' ? ' URGENT' : ''}${
    reason ? `: ${reason.slice(0, 70)}` : ''
  }`
  const emailHtml = `
<h2>Rabecca voice AI alert</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
  <tr><td><strong>Source</strong></td><td>${escapeHtml(source)}</td></tr>
  ${
    context.callId
      ? `<tr><td><strong>Retell call ID</strong></td><td>${escapeHtml(context.callId)}</td></tr>`
      : ''
  }
  <tr><td><strong>Urgency</strong></td><td>${escapeHtml(urgency)}</td></tr>
  ${reason ? `<tr><td><strong>Reason</strong></td><td>${escapeHtml(reason)}</td></tr>` : ''}
  <tr><td><strong>Customer</strong></td><td>${escapeHtml(customerName || 'Not provided')}</td></tr>
  <tr><td><strong>Phone</strong></td><td>${escapeHtml(customerPhone || 'Not provided')}</td></tr>
  <tr><td><strong>Email</strong></td><td>${escapeHtml(customerEmail || 'Not provided')}</td></tr>
  <tr><td><strong>Address</strong></td><td>${escapeHtml(serviceAddress || 'Not provided')}</td></tr>
</table>
<h3>Message</h3>
<pre style="background:#f4f4f4;padding:12px;border-radius:4px;white-space:pre-wrap;">${escapeHtml(message)}</pre>
<p style="color:#666;font-size:12px;">Sent by Rabecca through the Retell voice intake flow.</p>`

  const resendKey = process.env.RESEND_API_KEY
  const toEmail = process.env.OWNER_ALERT_EMAIL || process.env.ADMIN_EMAIL
  const fromEmail =
    process.env.OPS_EMAIL_FROM || 'Sasquatch Alerts <onboarding@resend.dev>'

  const results = await Promise.allSettled([
    sendAdminSMS(smsMessage, 'retell_rabecca_alert'),
    (async () => {
      if (!resendKey || !toEmail) {
        console.warn(
          '[Rabecca] Email alert skipped: RESEND_API_KEY or OWNER_ALERT_EMAIL/ADMIN_EMAIL not set',
        )
        return false
      }
      const resend = new Resend(resendKey)
      const { error } = await resend.emails.send(
        {
          from: fromEmail,
          to: toEmail,
          subject: emailSubject,
          html: emailHtml,
        },
        {
          idempotencyKey: `rabecca-alert/${context.callId || 'no-call'}/${shortHash(
            details,
          )}`,
        },
      )
      if (error) {
        console.error('[Rabecca] Email alert error:', error)
        return false
      }
      return true
    })(),
    sendTelegramNotification(`RABECCA VOICE AI ALERT\n\n${details}`),
  ])

  return response(true, 'Admin notification sent.', {
    source,
    channels: {
      sms: results[0].status === 'fulfilled',
      email: results[1].status === 'fulfilled' ? results[1].value : false,
      telegram: results[2].status === 'fulfilled' ? results[2].value : false,
    },
  })
}

export async function executeRebeccaRetellTool(
  name: RetellFunctionName,
  args: Record<string, unknown>,
  context: RebeccaToolContext,
): Promise<RetellFunctionResponse> {
  switch (name) {
    case 'get_service_catalog':
      return getServiceCatalog(args, context)
    case 'get_calendar_slots':
      return getCalendarSlots(args, context)
    case 'create_booking':
      return createBooking(args, context)
    case 'create_estimate':
      return createEstimate(args, context)
    case 'list_caller_appointments':
      return listCallerAppointments(args, context)
    case 'schedule_reclean':
      return scheduleReclean(args, context)
    case 'notify_admin':
      return notifyAdmin(args, context)
    default:
      return response(false, `Unsupported Rabecca tool: ${name}`)
  }
}
