/**
 * Public Appointment Booking API
 * Called from sasquatch.com booking widget — no user session required.
 * Secured by BOOKING_API_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-booking-secret',
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
    // Validate booking secret
    const secret = request.headers.get('x-booking-secret')
    if (!secret || secret !== process.env.BOOKING_API_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: CORS },
      )
    }

    const body = await request.json()
    const supabase = createAdminClient()

    // --- Validate required fields ---
    const firstName = String(body.customer?.first_name || '').trim()
    const lastName = String(body.customer?.last_name || '').trim()
    const email = String(body.customer?.email || '').trim()
    const phone = normalizePhone(String(body.customer?.phone || '').trim())
    const notes = body.customer?.notes
      ? String(body.customer.notes).trim()
      : null

    if (!firstName || !lastName || !email || !phone) {
      return NextResponse.json(
        { error: 'First name, last name, email, and phone are required' },
        { status: 400, headers: CORS },
      )
    }

    const street1 = String(body.address?.street_1 || '').trim()
    const city = String(body.address?.city || '').trim()
    const state = String(body.address?.state || 'CO').trim()
    const zipCode = String(body.address?.zip_code || '').trim()

    if (!street1 || !city || !zipCode) {
      return NextResponse.json(
        { error: 'Service address is required' },
        { status: 400, headers: CORS },
      )
    }

    const appointmentDate = String(
      body.appointment?.appointment_date || '',
    ).trim()
    const startTime = String(body.appointment?.start_time || '').trim()

    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'Appointment date and time are required' },
        { status: 400, headers: CORS },
      )
    }

    const lineItems: Array<{
      service_catalog_item_id?: string
      name_snapshot: string
      quantity: number
      unit_price: number
      duration_minutes?: number
    }> = Array.isArray(body.line_items) ? body.line_items : []

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one service is required' },
        { status: 400, headers: CORS },
      )
    }

    // --- Validate & apply promo code ---
    let discountAmount = 0
    const promoCode = body.promo_code
      ? String(body.promo_code).toUpperCase().trim()
      : null

    if (promoCode) {
      const { data: promo } = await supabase
        .from('promo_codes')
        .select('discount_type, discount_amount')
        .eq('code', promoCode)
        .eq('active', true)
        .maybeSingle()

      if (promo) {
        const subtotal = lineItems.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0,
        )
        discountAmount =
          promo.discount_type === 'percent'
            ? Math.round(((subtotal * promo.discount_amount) / 100) * 100) / 100
            : promo.discount_amount
      }
    }

    // --- Upsert customer ---
    const fullName = `${firstName} ${lastName}`.trim()
    const { data: customer, error: customerError } = await supabase
      .from('ops_customers')
      .upsert(
        {
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          notes,
        },
        { onConflict: 'email' },
      )
      .select('id, quickbooks_customer_id')
      .single()

    if (customerError) throw customerError

    // --- Upsert service address ---
    const { data: address, error: addressError } = await supabase
      .from('ops_service_addresses')
      .upsert(
        {
          customer_id: customer.id,
          street_1: street1,
          city,
          state,
          zip_code: zipCode,
          label: 'Service Address',
        },
        { onConflict: 'customer_id,street_1,zip_code' },
      )
      .select('id')
      .single()

    if (addressError) throw addressError

    // --- Calculate totals ---
    const subtotal = lineItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    )
    const total = Math.max(0, subtotal - discountAmount)

    // --- Calculate end time ---
    const totalMinutes = lineItems.reduce((sum, item) => {
      return (
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: item.duration_minutes || 60,
          quantity: item.quantity,
        })
      )
    }, 0)
    const buffered = applyAppointmentBuffer(totalMinutes)
    const [sh, sm] = startTime.split(':').map(Number)
    const endTotal = sh * 60 + sm + buffered
    const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

    // --- Create appointment ---
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customer.id,
        service_address_id: address.id,
        appointment_date: appointmentDate,
        start_time: startTime,
        end_time: endTime,
        status: 'booked',
        payment_status: 'unpaid',
        quoted_total: total,
        booking_channel: 'website',
        source: 'website',
      })
      .select('id')
      .single()

    if (appointmentError) throw appointmentError

    // --- Create invoice ---
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: appointment.id,
        customer_id: customer.id,
        subtotal,
        discount_amount: discountAmount,
        total,
        status: 'draft',
        sync_status: 'pending',
      })
      .select('id')
      .single()

    if (invoiceError) throw invoiceError

    // --- Insert line items ---
    const invoiceLines = lineItems.map((item) => ({
      invoice_id: invoice.id,
      description: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.unit_price * item.quantity,
      service_catalog_item_id: item.service_catalog_item_id || null,
    }))

    await supabase.from('ops_invoice_line_items').insert(invoiceLines)

    // --- Status events ---
    const syncStatus = getQuickBooksSyncStatus()
    await Promise.all([
      supabase.from('ops_appointment_status_events').insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: 'booked',
        notes: 'Appointment created via sasquatch.com booking widget',
      }),
      supabase.from('ops_invoice_status_events').insert({
        invoice_id: invoice.id,
        from_status: null,
        to_status: 'draft',
        notes: 'Invoice created via website booking',
      }),
      supabase.from('ops_quickbooks_sync_jobs').insert([
        {
          entity_type: 'customer',
          entity_id: customer.id,
          status: syncStatus,
          payload: buildQuickBooksCustomerPayload({
            customerId: customer.id,
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
            customerId: customer.id,
            serviceDate: appointmentDate,
            subtotal,
            total,
            lineItems: invoiceLines,
          }),
        },
      ]),
    ])

    // --- Fire comms + QB sync (non-blocking) ---
    const [commsResult, qbResult] = await Promise.allSettled([
      sendOpsLifecycleCommunications({
        event: 'job_scheduled',
        appointmentId: appointment.id,
      }),
      syncAppointmentToQuickBooks(appointment.id),
    ])
    if (commsResult.status === 'rejected')
      console.error('[public/appointments] Comms error:', commsResult.reason)
    if (qbResult.status === 'rejected')
      console.error('[public/appointments] QB sync error:', qbResult.reason)

    // --- Generate confirmation number ---
    const confirmationNumber = `SC-${appointment.id.slice(0, 8).toUpperCase()}`

    return NextResponse.json(
      {
        success: true,
        appointment_id: appointment.id,
        invoice_id: invoice.id,
        confirmation_number: confirmationNumber,
        total,
        discount_applied: discountAmount,
      },
      { headers: CORS },
    )
  } catch (error) {
    console.error('[public/appointments] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create appointment. Please call (719) 249-8791.' },
      { status: 500, headers: CORS },
    )
  }
}
