/**
 * createAiStyleEstimate
 *
 * Books a measurement/walkthrough visit as an ops_appointments row with
 * kind='estimate'. This is what Harry and Scout use when a customer asks
 * about commercial work or anything else that needs an on-site quote —
 * we put Charles on the calendar to measure, and he'll build the real
 * quote from there.
 *
 * Key differences vs createAiStyleBooking:
 *   - kind='estimate', estimate_status='draft'
 *   - No ops_invoices row (estimates skip invoicing until they convert)
 *   - quoted_total defaults to 0 (the real number comes from the walkthrough)
 *   - quickbooks_sync_status='held' — don't push anything to QB yet
 *   - Optional business_name on the customer (commercial contact)
 *   - Default visit duration is 30 min unless caller overrides
 *   - No customer-facing email/SMS template runs automatically (lifecycle
 *     templates target real service jobs). Admin gets a push + SMS instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAppointmentBuffer,
  getAvailableSlots,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'

export type CreateAiStyleEstimateInput = {
  supabase: SupabaseClient
  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string
    business_name?: string | null
  }
  address: {
    street_1: string
    city: string
    state: string
    zip_code: string
  }
  appointment_date: string
  start_time: string
  /** Visit duration in minutes. Defaults to 60 (one hour walkthrough). */
  visit_duration_minutes?: number
  /** Free-text summary of what the customer wants quoted. */
  job_description?: string | null
  /** 'ai_agent' for Scout web, 'sms_harry' for Harry SMS, etc. */
  booking_channel: string
  /** Shown on the appointment row + admin notifications. */
  source_label: string
  /** Status-event + admin heading actor. */
  actor_label: string
  admin_heading: string
}

export type CreateAiStyleEstimateResult =
  | {
      ok: true
      appointment_id: string
      confirmation_number: string
      appointment_date: string
      start_time: string
      end_time: string
      visit_duration_minutes: number
      message: string
    }
  | {
      ok: false
      error: string
      suggested_slots?: string[]
    }

const DEFAULT_VISIT_MINUTES = 60

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

  let templates = templatesResult.data || []
  if (templates.length === 0) {
    templates = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES as typeof templates
  }

  return {
    templates,
    overrides: overridesResult.data || [],
    appointments: (appointmentsResult.data ||
      []) as ExistingAppointmentWindow[],
  }
}

function normClock5(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim())
  if (!m) return '09:00'
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function addMinutesToHHMM(value: string, minutesToAdd: number): string {
  const [h, m] = value.split(':').map(Number)
  const total = h * 60 + m + minutesToAdd
  const n = ((total % 1440) + 1440) % 1440
  const nh = Math.floor(n / 60)
  const nm = n % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}:00`
}

export async function createAiStyleEstimate(
  input: CreateAiStyleEstimateInput,
): Promise<CreateAiStyleEstimateResult> {
  const {
    supabase,
    customer,
    address,
    appointment_date: appointmentDate,
    start_time: startTimeRaw,
    visit_duration_minutes: visitMinutesRaw,
    job_description: jobDescription,
    booking_channel: bookingChannel,
    source_label: sourceLabel,
    actor_label: actorLabel,
    admin_heading: adminHeading,
  } = input

  const firstName = customer.first_name.trim()
  const lastName = customer.last_name.trim()
  const email = customer.email.trim()
  const phone = customer.phone.trim()
  const businessName = (customer.business_name || '').trim() || null
  const street1 = address.street_1.trim()
  const city = address.city.trim()
  const state = address.state.trim() || 'CO'
  const zipCode = address.zip_code.trim()
  const startTime = normClock5(startTimeRaw)

  if (!firstName || !lastName || !email || !phone) {
    return {
      ok: false,
      error: 'Customer first name, last name, email, and phone are required',
    }
  }
  if (!street1 || !city || !zipCode) {
    return { ok: false, error: 'Street, city, and zip are required' }
  }
  if (!appointmentDate || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    return {
      ok: false,
      error: 'appointment_date must be YYYY-MM-DD',
    }
  }

  const visitMinutes =
    Number.isFinite(visitMinutesRaw) && (visitMinutesRaw as number) > 0
      ? Math.min(240, Math.max(15, Number(visitMinutesRaw)))
      : DEFAULT_VISIT_MINUTES

  const requiredMinutes = applyAppointmentBuffer(visitMinutes)

  // Validate the slot is real so two AI agents can't accidentally double-book.
  const bundle = await loadAvailabilityBundle(supabase, appointmentDate)
  const slots = getAvailableSlots({
    date: appointmentDate,
    requiredMinutes,
    templates: bundle.templates,
    overrides: bundle.overrides,
    appointments: bundle.appointments,
    maxResults: 48,
  })
  const slotMatch = slots.some((s) => normClock5(s.start_time) === startTime)
  if (!slotMatch) {
    return {
      ok: false,
      error: `That start time is not available on ${appointmentDate}. Call get_calendar_slots with duration_minutes=${visitMinutes} and offer a listed time.`,
      suggested_slots: slots.slice(0, 8).map((s) => normClock5(s.start_time)),
    }
  }

  // --- Customer: prefer match by email, fall back to phone match ---
  const fullName = businessName
    ? `${businessName} (${firstName} ${lastName})`
    : `${firstName} ${lastName}`.trim()

  let customerId: string

  const { data: existingByEmail } = await supabase
    .from('ops_customers')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  let existingCustomerRow: { id: string } | null = existingByEmail ?? null

  if (!existingCustomerRow) {
    const { data: existingByPhone } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle()
    existingCustomerRow = existingByPhone ?? null
  }

  if (existingCustomerRow) {
    customerId = existingCustomerRow.id
    const update: Record<string, unknown> = {
      full_name: fullName,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      updated_at: new Date().toISOString(),
    }
    if (businessName) update.business_name = businessName
    await supabase.from('ops_customers').update(update).eq('id', customerId)
  } else {
    const { data: newCustomer, error: insertErr } = await supabase
      .from('ops_customers')
      .insert({
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        business_name: businessName,
        email,
        phone,
      })
      .select('id')
      .single()
    if (insertErr) {
      console.error('[createAiStyleEstimate] insert customer:', insertErr)
      return { ok: false, error: 'Could not create customer record' }
    }
    customerId = newCustomer.id
  }

  // --- Service address: reuse if the customer already has this street+zip ---
  const { data: existingAddress } = await supabase
    .from('ops_service_addresses')
    .select('id')
    .eq('customer_id', customerId)
    .eq('street_1', street1)
    .eq('zip_code', zipCode)
    .maybeSingle()

  let addressId: string
  if (existingAddress) {
    addressId = existingAddress.id
    await supabase
      .from('ops_service_addresses')
      .update({ city, state, updated_at: new Date().toISOString() })
      .eq('id', addressId)
  } else {
    const { data: newAddress, error: addrErr } = await supabase
      .from('ops_service_addresses')
      .insert({
        customer_id: customerId,
        street_1: street1,
        city,
        state,
        zip_code: zipCode,
        label: businessName || 'Walkthrough Address',
      })
      .select('id')
      .single()
    if (addrErr) {
      console.error('[createAiStyleEstimate] address:', addrErr)
      return { ok: false, error: 'Could not save service address' }
    }
    addressId = newAddress.id
  }

  const endTime = addMinutesToHHMM(startTime, requiredMinutes)

  // --- Create the estimate appointment ---
  const internalNotesParts: string[] = []
  if (businessName) internalNotesParts.push(`Business: ${businessName}`)
  if (jobDescription && jobDescription.trim()) {
    internalNotesParts.push(`Job details: ${jobDescription.trim()}`)
  }
  internalNotesParts.push(`Scheduled via ${actorLabel}.`)
  const internalNotes = internalNotesParts.join('\n')

  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      appointment_date: appointmentDate,
      start_time: `${startTime}:00`,
      end_time: endTime,
      status: 'confirmed',
      payment_status: 'unpaid',
      booking_channel: bookingChannel,
      source: sourceLabel,
      kind: 'estimate',
      estimate_status: 'draft',
      quickbooks_sync_status: 'held',
      quoted_total: 0,
      internal_notes: internalNotes,
    })
    .select('id')
    .single()

  if (appointmentError || !appointment) {
    console.error(
      '[createAiStyleEstimate] appointment insert:',
      appointmentError,
    )
    return { ok: false, error: 'Could not create estimate appointment' }
  }

  await supabase.from('ops_appointment_status_events').insert({
    appointment_id: appointment.id,
    from_status: null,
    to_status: 'confirmed',
    notes: `Estimate (walkthrough) scheduled via ${actorLabel}`,
  })

  // Notify Charles — SMS + OneSignal. Estimates don't trigger the customer
  // lifecycle template pipeline; Charles can follow up directly.
  const adminMsg = [
    `New ${adminHeading}!`,
    businessName ? `${businessName} — ${firstName} ${lastName}` : fullName,
    jobDescription
      ? jobDescription.slice(0, 140)
      : 'Walkthrough / on-site estimate',
    `${street1}, ${city}, ${state} ${zipCode}`,
    `${appointmentDate} at ${startTime}`,
    `Contact: ${phone} · ${email}`,
    `Source: ${sourceLabel}`,
  ]
    .filter(Boolean)
    .join('\n')

  await Promise.allSettled([
    sendAdminSMS(adminMsg, 'new_estimate'),
    sendOneSignalNotification({
      heading: `New ${adminHeading}`,
      content: `${businessName || fullName} · ${appointmentDate} ${startTime}`,
      data: { type: 'new_estimate', appointment_id: appointment.id },
    }),
  ])

  const confirmationNumber = `EST-${appointment.id.slice(0, 8).toUpperCase()}`

  return {
    ok: true,
    appointment_id: appointment.id,
    confirmation_number: confirmationNumber,
    appointment_date: appointmentDate,
    start_time: startTime,
    end_time: endTime.slice(0, 5),
    visit_duration_minutes: visitMinutes,
    message: `Walkthrough booked! Confirmation: ${confirmationNumber}. Charles will be on-site on ${appointmentDate} at ${startTime} to measure and build your quote.`,
  }
}
