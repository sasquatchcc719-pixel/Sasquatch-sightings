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
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { checkServiceArea } from '@/lib/service-area'
import { resolveServiceAddress } from '@/lib/ops/addresses'
import { computePromoDiscountAmount } from '@/lib/promo-discount'

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

    // Validate service area
    const serviceAreaCheck = checkServiceArea(zipCode)
    if (!serviceAreaCheck.allowed) {
      return NextResponse.json(
        { error: serviceAreaCheck.message },
        { status: 400, headers: CORS },
      )
    }

    const appointmentDate = String(
      body.appointment?.appointment_date || '',
    ).trim()
    const startTime = String(body.appointment?.start_time || '').trim()
    const leadSource = String(body.appointment?.lead_source || '').trim()

    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'Appointment date and time are required' },
        { status: 400, headers: CORS },
      )
    }

    if (!leadSource) {
      return NextResponse.json(
        { error: 'Please let us know how you heard about us' },
        { status: 400, headers: CORS },
      )
    }

    const lineItems: Array<{
      service_catalog_item_id?: string
      name_snapshot: string
      quantity: number
      unit_price: number
      duration_minutes?: number
      pricing_unit?: string
    }> = Array.isArray(body.line_items) ? body.line_items : []

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one service is required' },
        { status: 400, headers: CORS },
      )
    }

    // Hydrate pricing_unit from the catalog for any items that provided a
    // service_catalog_item_id. This ensures duration is not multiplied by
    // quantity for measurement-based services (per_linear_foot, per_sqft, etc.)
    const catalogIds = lineItems
      .map((i) => i.service_catalog_item_id)
      .filter(Boolean) as string[]
    if (catalogIds.length > 0) {
      const { data: catalogRows } = await supabase
        .from('service_catalog_items')
        .select('id, pricing_unit')
        .in('id', catalogIds)
      if (catalogRows) {
        const catalogMap = new Map(
          catalogRows.map((r) => [r.id, r.pricing_unit]),
        )
        for (const item of lineItems) {
          if (item.service_catalog_item_id && !item.pricing_unit) {
            item.pricing_unit =
              catalogMap.get(item.service_catalog_item_id) ?? 'fixed'
          }
        }
      }
    }

    // --- Validate & apply promo code ---
    let discountAmount = 0
    const promoCode = body.promo_code
      ? String(body.promo_code).toUpperCase().trim()
      : null
    let promoCodeId: string | null = null

    if (promoCode) {
      const { data: promo } = await supabase
        .from('promo_codes')
        .select(
          'id, discount_type, discount_amount, expires_at, max_uses, use_count',
        )
        .eq('code', promoCode)
        .eq('active', true)
        .maybeSingle()

      if (promo) {
        // Enforce expiry
        if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
          return NextResponse.json(
            { error: `Promo code "${promoCode}" has expired.` },
            { status: 400, headers: CORS },
          )
        }
        // Enforce usage cap
        if (promo.max_uses !== null && promo.use_count >= promo.max_uses) {
          return NextResponse.json(
            { error: `Promo code "${promoCode}" has reached its usage limit.` },
            { status: 400, headers: CORS },
          )
        }

        const subtotal = lineItems.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0,
        )
        discountAmount = computePromoDiscountAmount(
          subtotal,
          promo.discount_type,
          Number(promo.discount_amount),
        )
        promoCodeId = promo.id
      }
    }

    // --- Find or create customer ---
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
      const { error: updateErr } = await supabase
        .from('ops_customers')
        .update({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
      if (updateErr) throw updateErr
    } else {
      const { data: newCustomer, error: insertErr } = await supabase
        .from('ops_customers')
        .insert({
          full_name: fullName,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          notes,
        })
        .select('id, quickbooks_customer_id')
        .single()
      if (insertErr) throw insertErr
      customerId = newCustomer.id
      quickbooksCustomerId = newCustomer.quickbooks_customer_id
    }

    // --- Find or create service address ---
    const resolved = await resolveServiceAddress(supabase, customerId, {
      label: 'Service Address',
      street_1: street1,
      city,
      state,
      zip_code: zipCode,
    })

    if (!resolved) {
      return NextResponse.json(
        { error: 'Failed to save service address' },
        { status: 500, headers: CORS },
      )
    }

    const addressId = resolved.id

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
          pricingUnit: item.pricing_unit,
          unitPrice: item.unit_price,
          nameSnapshot: item.name_snapshot,
        })
      )
    }, 0)
    const buffered = applyAppointmentBuffer(totalMinutes)
    const [sh, sm] = startTime.split(':').map(Number)
    const endTotal = sh * 60 + sm + buffered
    const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

    // --- Determine appointment status ---
    // If location requires travel approval, set to pending_approval instead of booked
    const appointmentStatus = serviceAreaCheck.requiresApproval
      ? 'pending_approval'
      : 'booked'

    // --- Create appointment ---
    // Public website bookings are always service appointments. Estimate
    // requests from visitors are out of scope; Charles creates estimates
    // manually from the admin UI.
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: appointmentDate,
        start_time: startTime,
        end_time: endTime,
        status: appointmentStatus,
        payment_status: 'unpaid',
        quoted_total: total,
        booking_channel: 'website',
        source: 'website',
        lead_source: leadSource,
        kind: 'service',
      })
      .select('id')
      .single()

    if (appointmentError) throw appointmentError

    // --- Create invoice ---
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

    // --- Insert line items ---
    const invoiceLines = lineItems.map((item) => ({
      invoice_id: invoice.id,
      description: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.unit_price * item.quantity,
    }))

    await supabase.from('ops_invoice_line_items').insert(invoiceLines)

    // --- Insert appointment line items ---
    const appointmentLines = lineItems.map((item) => ({
      appointment_id: appointment.id,
      name_snapshot: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      duration_minutes: item.duration_minutes || 0,
      line_total: item.unit_price * item.quantity,
    }))

    await supabase.from('ops_appointment_line_items').insert(appointmentLines)

    // --- Status events ---
    const syncStatus = getQuickBooksSyncStatus()
    const statusNotes = serviceAreaCheck.requiresApproval
      ? 'Appointment created via sasquatch.com booking widget (pending approval for extended service area)'
      : 'Appointment created via sasquatch.com booking widget'

    await Promise.all([
      supabase.from('ops_appointment_status_events').insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: appointmentStatus,
        notes: statusNotes,
      }),
      supabase.from('ops_invoice_status_events').insert({
        invoice_id: invoice.id,
        from_status: null,
        to_status: 'draft',
        notes: 'Invoice created via website booking',
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

    // --- Fire comms + QB sync (non-blocking) ---
    // Only send confirmation comms if fully booked (not pending approval)
    if (appointmentStatus === 'booked') {
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
    }

    // --- Notify admin (SMS + push + email) ---
    const serviceNames = lineItems
      .map((item) => item.name_snapshot)
      .filter(Boolean)
      .join(', ')
    const statusLabel =
      appointmentStatus === 'pending_approval' ? ' (NEEDS APPROVAL)' : ''
    const adminHeading = `New job booked${statusLabel}!`
    const adminMsg = [
      adminHeading,
      `${fullName} — $${total.toFixed(2)}`,
      `${serviceNames}`,
      `${street1}, ${city}, ${state} ${zipCode}`,
      `${appointmentDate} at ${startTime.slice(0, 5)}`,
      ...(serviceAreaCheck.requiresApproval
        ? ['⚠️ Extended service area - confirm travel fee']
        : []),
    ].join('\n')

    await Promise.allSettled([
      sendAdminSMS(adminMsg, 'new_booking'),
      sendOneSignalNotification({
        heading: adminHeading,
        content: `${fullName} — $${total.toFixed(2)} · ${appointmentDate}`,
        data: {
          type: 'new_booking',
          appointment_id: appointment.id,
        },
      }),
      (async () => {
        const adminEmail = process.env.ADMIN_EMAIL
        const resendKey = process.env.RESEND_API_KEY
        if (!adminEmail || !resendKey) return
        const { Resend } = await import('resend')
        const resend = new Resend(resendKey)
        const fromEmail =
          process.env.OPS_EMAIL_FROM ||
          'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          subject: `New Job Booked${statusLabel} — ${fullName} · $${total.toFixed(2)}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <h2 style="color:${appointmentStatus === 'pending_approval' ? '#f59e0b' : '#16a34a'};margin:0 0 16px;">New Job Booked${statusLabel}</h2>
  ${serviceAreaCheck.requiresApproval ? '<p style="color:#f59e0b;font-weight:600;margin:0 0 12px;">⚠️ Extended service area - confirm travel fee with customer</p>' : ''}
  <table style="font-size:14px;line-height:1.6;">
    <tr><td style="color:#6b7280;padding-right:12px;">Customer</td><td><strong>${fullName}</strong></td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Phone</td><td>${phone}</td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Email</td><td>${email}</td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Address</td><td>${street1}, ${city}, ${state} ${zipCode}</td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Date</td><td>${appointmentDate} at ${startTime.slice(0, 5)}</td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Services</td><td>${serviceNames}</td></tr>
    <tr><td style="color:#6b7280;padding-right:12px;">Total</td><td><strong>$${total.toFixed(2)}</strong></td></tr>
  </table>
  <a href="https://sightings.sasquatchcarpet.com/admin/operations" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View in Sightings</a>
</div>`,
        })
      })(),
    ])

    // --- Increment promo code redemption counter (fire-and-forget) ---
    if (promoCodeId) {
      void supabase
        .rpc('increment_promo_use_count', { promo_id: promoCodeId })
        .then(({ error: rpcErr }) => {
          if (rpcErr)
            console.error(
              '[public/appointments] promo use_count increment failed:',
              rpcErr,
            )
        })
    }

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
