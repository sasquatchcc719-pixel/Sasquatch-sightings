import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  validateAgentRequest,
  getAgentPromoSettings,
  checkRateLimit,
} from '@/lib/agent-auth'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return phone.startsWith('+') ? phone : `+${digits}`
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await validateAgentRequest(request)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: CORS },
      )
    }

    const rl = checkRateLimit(auth.key.id, '/api/agent/book')
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error:
            'Rate limit exceeded. Booking is limited to 5 requests per minute.',
        },
        {
          status: 429,
          headers: {
            ...CORS,
            'Retry-After': String(Math.ceil((rl.retryAfterMs || 60000) / 1000)),
          },
        },
      )
    }

    const body = await request.json()
    const supabase = createAdminClient()

    const firstName = String(body.customer?.first_name || '').trim()
    const lastName = String(body.customer?.last_name || '').trim()
    const email = String(body.customer?.email || '').trim()
    const phone = normalizePhone(String(body.customer?.phone || '').trim())

    if (!firstName || !lastName || !email || !phone) {
      return NextResponse.json(
        {
          error:
            'customer.first_name, customer.last_name, customer.email, and customer.phone are all required',
        },
        { status: 400, headers: CORS },
      )
    }

    const street1 = String(body.address?.street_1 || '').trim()
    const city = String(body.address?.city || '').trim()
    const state = String(body.address?.state || 'CO').trim()
    const zipCode = String(body.address?.zip_code || '').trim()

    if (!street1 || !city || !zipCode) {
      return NextResponse.json(
        {
          error:
            'address.street_1, address.city, and address.zip_code are required',
        },
        { status: 400, headers: CORS },
      )
    }

    const appointmentDate = String(body.date || '').trim()
    const startTime = String(body.start_time || '').trim()

    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'date (YYYY-MM-DD) and start_time (HH:MM) are required' },
        { status: 400, headers: CORS },
      )
    }

    const requestedItems: Array<{ service_id: string; quantity: number }> =
      Array.isArray(body.line_items) ? body.line_items : []

    if (requestedItems.length === 0) {
      return NextResponse.json(
        {
          error:
            'line_items array is required with at least one { service_id, quantity }',
        },
        { status: 400, headers: CORS },
      )
    }

    const serviceIds = requestedItems.map((item) => item.service_id)
    const { data: catalogItems, error: catalogError } = await supabase
      .from('service_catalog_items')
      .select('id, name, base_price, default_duration_minutes')
      .in('id', serviceIds)
      .eq('is_active', true)

    if (catalogError) throw catalogError

    if (!catalogItems || catalogItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid services found for the provided service IDs' },
        { status: 400, headers: CORS },
      )
    }

    const lineItems = requestedItems
      .map((req) => {
        const catalog = catalogItems.find((c) => c.id === req.service_id)
        if (!catalog) return null
        const qty = Math.max(1, req.quantity || 1)
        return {
          service_catalog_item_id: catalog.id,
          name_snapshot: catalog.name,
          quantity: qty,
          unit_price: Number(catalog.base_price || 0),
          duration_minutes: catalog.default_duration_minutes || 60,
        }
      })
      .filter(Boolean) as Array<{
      service_catalog_item_id: string
      name_snapshot: string
      quantity: number
      unit_price: number
      duration_minutes: number
    }>

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the requested services are available' },
        { status: 400, headers: CORS },
      )
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

    const totalMinutes = lineItems.reduce(
      (sum, item) =>
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: item.duration_minutes,
          quantity: item.quantity,
        }),
      0,
    )
    const buffered = applyAppointmentBuffer(totalMinutes)
    const [sh, sm] = startTime.split(':').map(Number)
    const endTotal = sh * 60 + sm + buffered
    const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

    const fullName = `${firstName} ${lastName}`.trim()
    let customerId: string
    let quickbooksCustomerId: string | null = null

    const { data: existingCustomer } = await supabase
      .from('ops_customers')
      .select('id, quickbooks_customer_id')
      .eq('email', email)
      .maybeSingle()

    if (existingCustomer) {
      customerId = existingCustomer.id
      quickbooksCustomerId = existingCustomer.quickbooks_customer_id
      await supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
    } else {
      const { data: newCustomer, error: insertErr } = await supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
        })
        .select('id, quickbooks_customer_id')
        .single()
      if (insertErr) throw insertErr
      customerId = newCustomer.id
      quickbooksCustomerId = newCustomer.quickbooks_customer_id
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
      if (addrErr) throw addrErr
      addressId = newAddress.id
    }

    const appointmentStatus =
      auth.key.booking_mode === 'direct' ? 'booked' : 'pending_approval'

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
        booking_channel: 'ai_agent',
        source: auth.key.label,
        lead_source: `AI Agent (${auth.key.label})`,
      })
      .select('id')
      .single()

    if (appointmentError) throw appointmentError

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

    if (invoiceError) throw invoiceError

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
        notes: `Appointment created via AI agent (${auth.key.label})`,
      }),
      supabase.from('ops_invoice_status_events').insert({
        invoice_id: invoice.id,
        from_status: null,
        to_status: 'draft',
        notes: `Invoice created via AI agent booking (${auth.key.label})`,
      }),
      supabase.from('ops_quickbooks_sync_jobs').insert([
        {
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
        },
        {
          entity_type: 'invoice',
          entity_id: invoice.id,
          status: syncStatus,
          payload: buildQuickBooksInvoicePayload({
            invoiceId: invoice.id,
            customerId,
            serviceDate: appointmentDate,
            subtotal,
            total,
            lineItems: invoiceLines,
          }),
        },
      ]),
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
      `New AI Agent booking${statusLabel}!`,
      `${fullName} — $${total.toFixed(2)}`,
      serviceNames,
      `${street1}, ${city}, ${state} ${zipCode}`,
      `${appointmentDate} at ${startTime.slice(0, 5)}`,
      `Source: ${auth.key.label}`,
      ...(discountAmount > 0
        ? [`AI promo discount: -$${discountAmount.toFixed(2)}`]
        : []),
    ].join('\n')

    await Promise.allSettled([
      sendAdminSMS(adminMsg, 'new_booking'),
      sendOneSignalNotification({
        heading: `New AI Agent Booking${statusLabel}`,
        content: `${fullName} — $${total.toFixed(2)} · ${appointmentDate}`,
        data: { type: 'new_booking', appointment_id: appointment.id },
      }),
    ])

    const confirmationNumber = `SC-${appointment.id.slice(0, 8).toUpperCase()}`

    return NextResponse.json(
      {
        success: true,
        confirmation_number: confirmationNumber,
        status:
          appointmentStatus === 'booked' ? 'confirmed' : 'pending_approval',
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
      },
      { headers: CORS },
    )
  } catch (err) {
    console.error('[agent/book] Error:', err)
    return NextResponse.json(
      {
        error:
          'Failed to create booking. Please have the customer call (719) 249-8791.',
      },
      { status: 500, headers: CORS },
    )
  }
}
