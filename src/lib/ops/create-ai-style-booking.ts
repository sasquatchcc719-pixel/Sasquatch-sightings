import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  calendarEventsToAppointmentWindows,
  getAvailableSlots,
} from '@/lib/ops/availability'
import { getAgentPromoSettings } from '@/lib/agent-auth'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendBookingNotification, scheduleJobReminder } from '@/lib/telegram'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { resolveOpsCustomer } from '@/lib/ops/customers'
import { resolveServiceAddress } from '@/lib/ops/addresses'
import { cancelReactivationForCustomer } from '@/lib/ops/reactivation-campaign'
import { checkServiceArea } from '@/lib/service-area'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'

export type AiStyleBookingLineRequest = {
  service_id: string
  quantity: number
}

export type CreateAiStyleBookingInput = {
  supabase: SupabaseClient
  customer: {
    first_name: string
    last_name: string
    email: string
    phone: string
  }
  address: {
    street_1: string
    street_2?: string
    city: string
    state: string
    zip_code: string
  }
  appointment_date: string
  start_time: string
  line_items: AiStyleBookingLineRequest[]
  /** 'direct' → booked; otherwise pending_approval */
  booking_mode: 'direct' | 'request'
  booking_channel: 'ai_agent' | 'sms_harry' | 'lsa_sms' | 'retell_rabecca'
  /** Shown on appointment.source */
  source_label: string
  /** ops_appointments.lead_source */
  lead_source: string
  lead_source_detail?: string | null
  referrer_name?: string | null
  referrer_type?: string | null
  lead_notes?: string | null
  /** Used in status events / QB notes */
  actor_label: string
  /** Admin SMS / OneSignal heading prefix */
  admin_heading: string
  /** Rabecca may apply the AI promo only when the caller explicitly asks. */
  discount_requested?: boolean
  /** Customer explicitly agreed to pay the $150 minimum even when catalog lines price lower. */
  accepted_minimum_charge?: boolean
  /** Staff member to assign this appointment to. */
  assigned_staff_user_id?: string | null
}

export type CreateAiStyleBookingSuccess = {
  ok: true
  appointment_id: string
  confirmation_number: string
  appointment_status: 'booked' | 'pending_approval'
  appointment_date: string
  start_time: string
  end_time: string
  subtotal: number
  discount_applied: number
  total: number
  message: string
}

export type CreateAiStyleBookingFailure = {
  ok: false
  error: string
}

const REBECCA_RETELL_CHANNEL_LEAD_SOURCE = 'retell_rabecca'
export const GOOGLE_LSA_LEAD_RECOVERY_AMOUNT = 40

function normalizePartnerLookup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function linkPartnerReferralIfMatched(params: {
  supabase: SupabaseClient
  referrerName: string
  referrerType: string | null
  customerName: string
  customerPhone: string
  leadSource: string
  notes: string | null
}) {
  const referrerLookup = normalizePartnerLookup(params.referrerName)
  if (!referrerLookup) return

  const { data: partners, error } = await params.supabase
    .from('partners')
    .select('id, name, company_name, backlink_verified')
    .limit(200)

  if (error) {
    console.error('[createAiStyleBooking] partner lookup:', error)
    return
  }

  const matchedPartner = (partners || []).find((partner) => {
    const names = [partner.name, partner.company_name]
      .map((value) => normalizePartnerLookup(String(value || '')))
      .filter(Boolean)
    return names.some(
      (name) => name === referrerLookup || name.includes(referrerLookup),
    )
  })

  if (!matchedPartner) return

  const creditAmount = matchedPartner.backlink_verified ? 25 : 20
  const referralNotes = [
    params.notes,
    `Captured via ${params.leadSource}.`,
    params.referrerType ? `Referrer type: ${params.referrerType}.` : '',
  ]
    .filter(Boolean)
    .join('\n')

  await Promise.allSettled([
    params.supabase.from('referrals').insert({
      partner_id: matchedPartner.id,
      client_name: params.customerName,
      client_phone: params.customerPhone,
      notes: referralNotes || null,
      status: 'booked',
      credit_amount: creditAmount,
      booked_via_link: false,
    }),
    params.supabase.from('leads').insert({
      source: 'partner',
      name: params.customerName,
      phone: params.customerPhone,
      notes: referralNotes || null,
      partner_id: matchedPartner.id,
      status: 'scheduled',
      contacted_at: new Date().toISOString(),
      scheduled_at: new Date().toISOString(),
    }),
  ])
}

export function calculateAiStyleBookingDiscount(params: {
  booking_channel: CreateAiStyleBookingInput['booking_channel']
  subtotal: number
  promo: { enabled: boolean; discount: number; minimum: number }
  discount_requested?: boolean
}): number {
  if (
    params.booking_channel === 'retell_rabecca' &&
    !params.discount_requested
  ) {
    return 0
  }
  if (params.promo.enabled && params.subtotal >= params.promo.minimum) {
    return params.promo.discount
  }
  return 0
}

export async function createAiStyleBooking(
  input: CreateAiStyleBookingInput,
): Promise<CreateAiStyleBookingSuccess | CreateAiStyleBookingFailure> {
  const {
    supabase,
    customer,
    address,
    appointment_date: appointmentDate,
    start_time: startTimeRaw,
    line_items: requestedItems,
    booking_mode: bookingMode,
    booking_channel: bookingChannel,
    source_label: sourceLabel,
    lead_source: leadSource,
    lead_source_detail: leadSourceDetailRaw = null,
    referrer_name: referrerNameRaw = null,
    referrer_type: referrerTypeRaw = null,
    lead_notes: leadNotesRaw = null,
    actor_label: actorLabel,
    admin_heading: adminHeading,
    discount_requested: discountRequested = false,
    accepted_minimum_charge: acceptedMinimumCharge = false,
  } = input

  const firstName = customer.first_name.trim()
  const lastName = customer.last_name.trim()
  const email = customer.email.trim()
  const phone = customer.phone.trim()
  const street1 = address.street_1.trim()
  const street2 = address.street_2?.trim() || null
  const city = address.city.trim()
  const state = address.state.trim() || 'CO'
  const zipCode = address.zip_code.trim()
  const startTime = startTimeRaw.trim()
  const referrerName = (referrerNameRaw || '').trim() || null
  const referrerType = (referrerTypeRaw || '').trim() || null
  const leadNotes = (leadNotesRaw || '').trim() || null
  const normalizedLeadSource = leadSource.trim()
  const leadSourceDetail = (leadSourceDetailRaw || '').trim() || null

  if (!firstName || !lastName || !email || !phone) {
    return {
      ok: false,
      error: 'Customer first name, last name, email, and phone are required',
    }
  }
  if (!street1 || !city || !zipCode) {
    return { ok: false, error: 'Street, city, and zip are required' }
  }
  if (!appointmentDate || !startTime) {
    return { ok: false, error: 'Appointment date and start time are required' }
  }
  if (!requestedItems.length) {
    return { ok: false, error: 'At least one line item is required' }
  }
  if (!normalizedLeadSource) {
    return { ok: false, error: 'Lead source is required' }
  }
  const resolvedLeadSource = await normalizeLeadSourceForWrite({
    supabase,
    sourceKey: normalizedLeadSource,
    legacyValue: normalizedLeadSource,
    detail: leadSourceDetail || referrerName || leadNotes,
    requireActive: true,
    requirePublic: false,
    allowMissingDetail: bookingChannel === 'lsa_sms',
  })

  if (!resolvedLeadSource.ok) {
    return { ok: false, error: resolvedLeadSource.error }
  }

  if (
    bookingChannel === 'retell_rabecca' &&
    normalizedLeadSource.toLowerCase() === REBECCA_RETELL_CHANNEL_LEAD_SOURCE
  ) {
    return {
      ok: false,
      error:
        'Lead source must be where the customer heard about Sasquatch, not Rabecca voice AI.',
    }
  }

  // Validate service area
  const serviceAreaCheck = checkServiceArea(zipCode)
  if (!serviceAreaCheck.allowed) {
    return {
      ok: false,
      error: serviceAreaCheck.message,
    }
  }

  const serviceIds = requestedItems.map((item) => item.service_id)
  const { data: catalogItems, error: catalogError } = await supabase
    .from('service_catalog_items')
    .select(
      'id, name, slug, base_price, default_duration_minutes, pricing_unit',
    )
    .in('id', serviceIds)
    .eq('is_active', true)

  if (catalogError) {
    console.error('[createAiStyleBooking] catalog:', catalogError)
    return { ok: false, error: 'Could not load service catalog' }
  }

  if (!catalogItems || catalogItems.length === 0) {
    return {
      ok: false,
      error: 'No valid services found for the provided service IDs',
    }
  }

  const lineItems = requestedItems
    .map((req) => {
      const catalog = catalogItems.find((c) => c.id === req.service_id)
      if (!catalog) return null
      const qty = Math.max(1, req.quantity || 1)
      return {
        service_catalog_item_id: catalog.id,
        name_snapshot: catalog.name,
        catalog_slug: String(catalog.slug || ''),
        quantity: qty,
        unit_price: Number(catalog.base_price || 0),
        duration_minutes: catalog.default_duration_minutes || 60,
        pricing_unit: catalog.pricing_unit || 'fixed',
      }
    })
    .filter(Boolean) as Array<{
    service_catalog_item_id: string | null
    name_snapshot: string
    catalog_slug: string
    quantity: number
    unit_price: number
    duration_minutes: number
    pricing_unit: string
  }>

  if (lineItems.length === 0) {
    return { ok: false, error: 'None of the requested services are available' }
  }

  let serviceSubtotal = lineItems.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  )
  const travelCharge = serviceAreaCheck.travelCharge
  const googleLsaCharge =
    bookingChannel === 'lsa_sms' ? GOOGLE_LSA_LEAD_RECOVERY_AMOUNT : 0
  const MINIMUM_BOOKING_AMOUNT = 150
  const subtotalBeforeMinimum = serviceSubtotal + googleLsaCharge + travelCharge
  const minimumAdjustment =
    acceptedMinimumCharge && subtotalBeforeMinimum < MINIMUM_BOOKING_AMOUNT
      ? MINIMUM_BOOKING_AMOUNT - subtotalBeforeMinimum
      : 0
  if (minimumAdjustment > 0) {
    lineItems.push({
      service_catalog_item_id: null,
      name_snapshot: 'Minimum Dispatch Adjustment',
      catalog_slug: 'minimum-dispatch-adjustment',
      quantity: 1,
      unit_price: minimumAdjustment,
      duration_minutes: 0,
      pricing_unit: 'fixed',
    })
    serviceSubtotal += minimumAdjustment
  }
  if (googleLsaCharge > 0) {
    lineItems.push({
      service_catalog_item_id: null,
      name_snapshot: 'Google LSA Lead Charge',
      catalog_slug: 'google-lsa-lead-charge',
      quantity: 1,
      unit_price: googleLsaCharge,
      duration_minutes: 0,
      pricing_unit: 'fixed',
    })
  }
  const subtotal = serviceSubtotal + googleLsaCharge + travelCharge
  if (travelCharge > 0) {
    lineItems.push({
      service_catalog_item_id: null,
      name_snapshot: 'Mileage/ Travel',
      catalog_slug: 'mileage-travel',
      quantity: 1,
      unit_price: travelCharge,
      duration_minutes: 0,
      pricing_unit: 'fixed',
    })
  }

  if (subtotal < MINIMUM_BOOKING_AMOUNT) {
    return {
      ok: false,
      error: `Minimum booking amount is $${MINIMUM_BOOKING_AMOUNT}. Your current total is $${subtotal.toFixed(2)}. Please add more services to meet the minimum.`,
    }
  }

  const promo = await getAgentPromoSettings()
  const discountAmount = calculateAiStyleBookingDiscount({
    booking_channel: bookingChannel,
    subtotal,
    promo,
    discount_requested: discountRequested,
  })
  const total = Math.max(0, subtotal - discountAmount)

  // Calculate duration based on dollar amount (simple tier system)
  // $0-300 = 2hr, $301-600 = 3hr, $601+ = 4hr
  const appointmentDuration =
    calculateAppointmentDurationFromTotal(serviceSubtotal)
  const buffered = applyAppointmentBuffer(appointmentDuration)
  const [sh, sm] = startTime.split(':').map(Number)
  if (!Number.isFinite(sh) || !Number.isFinite(sm)) {
    return { ok: false, error: 'Please choose a valid appointment time.' }
  }
  const endTotal = sh * 60 + sm + buffered
  const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`
  const [templatesResult, overridesResult, appointmentsResult, eventsResult] =
    await Promise.all([
      supabase.from('availability_templates').select('*').eq('is_active', true),
      supabase
        .from('availability_overrides')
        .select('*')
        .eq('override_date', appointmentDate),
      supabase
        .from('ops_appointments')
        .select('appointment_date, start_time, end_time, status')
        .eq('appointment_date', appointmentDate),
      supabase
        .from('ops_calendar_events')
        .select(
          'event_kind, start_date, end_date, start_time, end_time, is_all_day',
        )
        .lte('start_date', appointmentDate)
        .gte('end_date', appointmentDate),
    ])

  if (templatesResult.error) {
    console.error('[createAiStyleBooking] templates:', templatesResult.error)
    return { ok: false, error: 'Could not load schedule availability' }
  }
  if (overridesResult.error) {
    console.error('[createAiStyleBooking] overrides:', overridesResult.error)
    return { ok: false, error: 'Could not load schedule availability' }
  }
  if (appointmentsResult.error) {
    console.error(
      '[createAiStyleBooking] appointments:',
      appointmentsResult.error,
    )
    return { ok: false, error: 'Could not load schedule availability' }
  }
  if (eventsResult.error) {
    console.error('[createAiStyleBooking] calendar events:', eventsResult.error)
    return { ok: false, error: 'Could not load schedule availability' }
  }

  const availableSlots = getAvailableSlots({
    date: appointmentDate,
    requiredMinutes: buffered,
    templates: templatesResult.data || [],
    overrides: overridesResult.data || [],
    appointments: [
      ...(appointmentsResult.data || []),
      ...calendarEventsToAppointmentWindows(
        appointmentDate,
        eventsResult.data || [],
      ),
    ],
    maxResults: 48,
  })
  const requestedStart = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`
  const slotIsAvailable = availableSlots.some(
    (slot) => slot.start_time === requestedStart,
  )
  if (!slotIsAvailable) {
    const suggestedSlots = availableSlots
      .slice(0, 8)
      .map((slot) => slot.start_time.slice(0, 5))
    const suggestionText =
      suggestedSlots.length > 0
        ? ` Available times: ${suggestedSlots.join(', ')}.`
        : ''
    return {
      ok: false,
      error: `That start time is not available on ${appointmentDate}.${suggestionText}`,
    }
  }

  const fullName = `${firstName} ${lastName}`.trim()
  let customerId: string
  try {
    const resolvedCustomer = await resolveOpsCustomer({
      supabase,
      firstName,
      lastName,
      email,
      phone,
    })
    customerId = resolvedCustomer.id
  } catch (customerErr) {
    console.error('[createAiStyleBooking] resolve customer:', customerErr)
    return { ok: false, error: 'Could not create customer record' }
  }

  const resolvedAddr = await resolveServiceAddress(supabase, customerId, {
    label: 'Service Address',
    street_1: street1,
    street_2: street2,
    city,
    state,
    zip_code: zipCode,
  })
  if (!resolvedAddr) {
    return { ok: false, error: 'Could not save service address' }
  }
  const addressId = resolvedAddr.id
  await supabase
    .from('ops_service_addresses')
    .update({ city, state, updated_at: new Date().toISOString() })
    .eq('id', addressId)

  const appointmentStatus =
    bookingMode === 'direct' ? 'booked' : 'pending_approval'

  const { data: appointment, error: appointmentError } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: customerId,
      service_address_id: addressId,
      appointment_date: appointmentDate,
      start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
      end_time: endTime,
      status: appointmentStatus,
      payment_status: 'unpaid',
      quoted_total: total,
      booking_channel: bookingChannel,
      source: sourceLabel,
      ...leadSourceUpdatePayload(resolvedLeadSource.source),
      kind: 'service',
      ...(input.assigned_staff_user_id
        ? { assigned_staff_user_id: input.assigned_staff_user_id }
        : {}),
    })
    .select('id')
    .single()

  if (appointmentError) {
    console.error('[createAiStyleBooking] appointment:', appointmentError)
    return { ok: false, error: 'Could not create appointment' }
  }

  await cancelReactivationForCustomer(customerId, 'booked_job')

  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: appointment.id,
      subtotal,
      discount_amount: discountAmount,
      total,
      status: 'draft',
      sync_status: 'pending',
    })
    .select('id')
    .single()

  if (invoiceError) {
    console.error('[createAiStyleBooking] invoice:', invoiceError)
    return { ok: false, error: 'Could not create invoice' }
  }

  const invoiceLines = lineItems.map((item) => ({
    invoice_id: invoice.id,
    description: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.unit_price * item.quantity,
  }))

  await supabase.from('ops_invoice_line_items').insert(invoiceLines)

  const appointmentLines = lineItems.map((item) => ({
    appointment_id: appointment.id,
    service_catalog_item_id: item.service_catalog_item_id,
    name_snapshot: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    duration_minutes: item.duration_minutes,
    line_total: item.unit_price * item.quantity,
    pricing_unit_snapshot: item.pricing_unit,
  }))

  await supabase.from('ops_appointment_line_items').insert(appointmentLines)

  const syncStatus = getQuickBooksSyncStatus()
  await Promise.all([
    supabase.from('ops_appointment_status_events').insert({
      appointment_id: appointment.id,
      from_status: null,
      to_status: appointmentStatus,
      notes: `Appointment created via ${actorLabel}`,
    }),
    supabase.from('ops_invoice_status_events').insert({
      invoice_id: invoice.id,
      from_status: null,
      to_status: 'draft',
      notes: `Invoice created via ${actorLabel}`,
    }),
    supabase.from('ops_quickbooks_sync_jobs').insert({
      entity_type: 'customer',
      entity_id: customerId,
      status: syncStatus,
      payload: buildQuickBooksCustomerPayload({
        customerId,
        fullName,
        email,
        phone,
        address: {
          street_1: street1,
          street_2: street2,
          city,
          state,
          zip_code: zipCode,
        },
      }),
    }),
  ])

  if (appointmentStatus === 'booked') {
    await Promise.allSettled([
      sendOpsLifecycleCommunications({
        event: 'job_scheduled',
        appointmentId: appointment.id,
      }),
      syncAppointmentToQuickBooks(appointment.id),
    ])
  }

  const serviceNames = lineItems.map((item) => item.name_snapshot).join(', ')
  const statusLabel =
    appointmentStatus === 'pending_approval' ? ' (NEEDS APPROVAL)' : ''
  const adminMsg = [
    `New ${adminHeading}${statusLabel}!`,
    `${fullName} — $${total.toFixed(2)}`,
    serviceNames,
    `${street1}, ${city}, ${state} ${zipCode}`,
    `${appointmentDate} at ${startTime.slice(0, 5)}`,
    `Source: ${sourceLabel}`,
    `Lead source: ${resolvedLeadSource.source.lead_source}`,
    resolvedLeadSource.source.lead_source_detail
      ? `Lead detail: ${resolvedLeadSource.source.lead_source_detail}`
      : '',
    ...(travelCharge > 0
      ? [`Travel-charge area: $${travelCharge.toFixed(2)} travel fee`]
      : []),
    ...(discountAmount > 0
      ? [`AI promo discount: -$${discountAmount.toFixed(2)}`]
      : []),
  ].join('\n')

  // Format date with year for notifications
  const dateWithYear = new Date(
    `${appointmentDate}T12:00:00`,
  ).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Denver',
  })

  await Promise.allSettled([
    sendAdminSMS(adminMsg, 'new_booking'),
    sendOneSignalNotification({
      heading: `New ${adminHeading}${statusLabel}`,
      content: `${fullName} — $${total.toFixed(2)} · ${dateWithYear}`,
      data: { type: 'new_booking', appointment_id: appointment.id },
    }),
    sendBookingNotification({
      customerName: fullName,
      phone,
      appointmentDate,
      startTime: startTime.slice(0, 5),
      total,
      leadSource: resolvedLeadSource.source.lead_source,
      services: lineItems.map((item) => item.name_snapshot),
    }),
  ])

  if (referrerName) {
    await linkPartnerReferralIfMatched({
      supabase,
      referrerName,
      referrerType,
      customerName: fullName,
      customerPhone: phone,
      leadSource: resolvedLeadSource.source.lead_source,
      notes: leadNotes,
    })
  }

  // Schedule 30-minute job reminder
  if (appointmentStatus === 'booked') {
    scheduleJobReminder({
      appointmentDate,
      startTime: startTime.slice(0, 5),
      customerName: fullName,
      address: `${street1}, ${city}, ${state} ${zipCode}`,
      appointmentId: appointment.id,
    })
  }

  const confirmationNumber = `SC-${appointment.id.slice(0, 8).toUpperCase()}`

  return {
    ok: true,
    appointment_id: appointment.id,
    confirmation_number: confirmationNumber,
    appointment_status: appointmentStatus,
    appointment_date: appointmentDate,
    start_time: startTime,
    end_time: endTime.slice(0, 5),
    subtotal,
    discount_applied: discountAmount,
    total,
    message:
      appointmentStatus === 'booked'
        ? `Booking confirmed! Confirmation number: ${confirmationNumber}. The customer will receive a confirmation text and email.`
        : `Booking request submitted for approval. Confirmation number: ${confirmationNumber}. Sasquatch Carpet Cleaning will confirm shortly.`,
  }
}
