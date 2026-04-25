import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
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
    city: string
    state: string
    zip_code: string
  }
  appointment_date: string
  start_time: string
  line_items: AiStyleBookingLineRequest[]
  /** 'direct' → booked; otherwise pending_approval */
  booking_mode: 'direct' | 'request'
  booking_channel: 'ai_agent' | 'sms_harry' | 'lsa_sms'
  /** Shown on appointment.source */
  source_label: string
  /** ops_appointments.lead_source */
  lead_source: string
  /** Used in status events / QB notes */
  actor_label: string
  /** Admin SMS / OneSignal heading prefix */
  admin_heading: string
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
    actor_label: actorLabel,
    admin_heading: adminHeading,
  } = input

  const firstName = customer.first_name.trim()
  const lastName = customer.last_name.trim()
  const email = customer.email.trim()
  const phone = customer.phone.trim()
  const street1 = address.street_1.trim()
  const city = address.city.trim()
  const state = address.state.trim() || 'CO'
  const zipCode = address.zip_code.trim()
  const startTime = startTimeRaw.trim()

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
    service_catalog_item_id: string
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

  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  )

  const promo = await getAgentPromoSettings()
  let discountAmount = 0
  if (promo.enabled && subtotal >= promo.minimum) {
    discountAmount = promo.discount
  }
  const total = Math.max(0, subtotal - discountAmount)

  // Calculate duration based on dollar amount (simple tier system)
  // $0-300 = 2hr, $301-600 = 3hr, $601+ = 4hr
  const appointmentDuration = calculateAppointmentDurationFromTotal(subtotal)
  const buffered = applyAppointmentBuffer(appointmentDuration)
  const [sh, sm] = startTime.split(':').map(Number)
  const endTotal = sh * 60 + sm + buffered
  const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

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
        label: 'Service Address',
      })
      .select('id')
      .single()
    if (addrErr) {
      console.error('[createAiStyleBooking] address:', addrErr)
      return { ok: false, error: 'Could not save service address' }
    }
    addressId = newAddress.id
  }

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
      lead_source: leadSource,
      // Harry / AI flows are always service appointments. Estimates are an
      // admin-only workflow today.
      kind: 'service',
    })
    .select('id')
    .single()

  if (appointmentError) {
    console.error('[createAiStyleBooking] appointment:', appointmentError)
    return { ok: false, error: 'Could not create appointment' }
  }

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
    name_snapshot: item.name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    duration_minutes: item.duration_minutes,
    line_total: item.unit_price * item.quantity,
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
        address: { street_1: street1, city, state, zip_code: zipCode },
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
    ...(discountAmount > 0
      ? [`AI promo discount: -$${discountAmount.toFixed(2)}`]
      : []),
  ].join('\n')

  await Promise.allSettled([
    sendAdminSMS(adminMsg, 'new_booking'),
    sendOneSignalNotification({
      heading: `New ${adminHeading}${statusLabel}`,
      content: `${fullName} — $${total.toFixed(2)} · ${appointmentDate}`,
      data: { type: 'new_booking', appointment_id: appointment.id },
    }),
    sendBookingNotification({
      customerName: fullName,
      phone,
      appointmentDate,
      startTime: startTime.slice(0, 5),
      total,
      leadSource: leadSource,
      services: lineItems.map((item) => item.name_snapshot),
    }),
  ])

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
