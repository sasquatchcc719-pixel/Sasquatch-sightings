/**
 * Public Appointment Booking API
 * Called from sasquatch.com booking widget — no user session required.
 * Secured by BOOKING_API_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  timeToMinutes,
} from '@/lib/ops/availability'
import { getStaffPrioritizedSlots } from '@/lib/ops/staff-availability'
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
import { resolveOpsCustomer } from '@/lib/ops/customers'
import {
  leadSourceUpdatePayload,
  normalizeLeadSourceForWrite,
} from '@/lib/server/lead-sources'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-booking-secret',
}

const MINIMUM_SAME_DAY_LEAD_MINUTES = 60

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
    const phone = String(body.customer?.phone || '').trim()
    const notes = body.customer?.notes
      ? String(body.customer.notes).trim()
      : null

    if (
      !firstName ||
      !lastName ||
      !email ||
      phone.replace(/\D/g, '').length < 10
    ) {
      return NextResponse.json(
        {
          error:
            'First name, last name, email, and a valid phone number are required',
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
    const leadSourceKey = String(body.appointment?.lead_source_key || '').trim()
    const leadSourceDetail = String(
      body.appointment?.lead_source_detail || '',
    ).trim()

    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'Appointment date and time are required' },
        { status: 400, headers: CORS },
      )
    }

    const normalizedLeadSource = await normalizeLeadSourceForWrite({
      supabase,
      sourceKey: leadSourceKey,
      legacyValue: leadSource,
      detail: leadSourceDetail,
      requireActive: true,
      requirePublic: true,
    })

    if (!normalizedLeadSource.ok) {
      return NextResponse.json(
        { error: normalizedLeadSource.error },
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
      category?: string
    }> = Array.isArray(body.line_items) ? body.line_items : []

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'At least one service is required' },
        { status: 400, headers: CORS },
      )
    }

    if (serviceAreaCheck.travelCharge > 0) {
      lineItems.push({
        name_snapshot: 'Mileage/ Travel',
        quantity: 1,
        unit_price: serviceAreaCheck.travelCharge,
        duration_minutes: 0,
        pricing_unit: 'fixed',
        category: 'Travel',
      })
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
        .select('id, pricing_unit, category')
        .in('id', catalogIds)
      if (catalogRows) {
        const catalogMap = new Map(
          catalogRows.map((r) => [
            r.id,
            { pricing_unit: r.pricing_unit, category: r.category },
          ]),
        )
        for (const item of lineItems) {
          if (item.service_catalog_item_id) {
            const catalogItem = catalogMap.get(item.service_catalog_item_id)
            if (!item.pricing_unit) {
              item.pricing_unit = catalogItem?.pricing_unit ?? 'fixed'
            }
            if (!item.category) {
              item.category = catalogItem?.category ?? undefined
            }
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
    const resolvedCustomer = await resolveOpsCustomer({
      supabase,
      firstName,
      lastName,
      email,
      phone,
      notes,
    })
    const customerId = resolvedCustomer.id
    const quickbooksCustomerId = resolvedCustomer.quickbooks_customer_id

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

    const requestedPercentageDiscount =
      body.percentage_discount &&
      typeof body.percentage_discount === 'object' &&
      body.percentage_discount.scope === 'rug_cleaning'
        ? {
            label: 'Multi-rug discount',
            percent: 10,
            scope: 'rug_cleaning',
          }
        : null
    const rugLineItems = lineItems.filter(
      (item) => item.category?.toLowerCase() === 'rug cleaning',
    )
    const rugUnitCount = rugLineItems.reduce((sum, item) => {
      const unit = String(item.pricing_unit || '').toLowerCase()
      const isMeasurement =
        unit.includes('sq') ||
        unit.includes('square') ||
        unit.includes('linear')
      return sum + (isMeasurement ? 1 : Number(item.quantity || 0))
    }, 0)
    const rugDiscountEligible = requestedPercentageDiscount && rugUnitCount >= 2
    const percentageDiscountScopeSubtotal = rugLineItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    )
    const percentageDiscountAmount = rugDiscountEligible
      ? Number(
          (
            (percentageDiscountScopeSubtotal *
              requestedPercentageDiscount.percent) /
            100
          ).toFixed(2),
        )
      : 0

    // --- Calculate totals ---
    const subtotal = lineItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    )
    const total = Math.max(
      0,
      subtotal - discountAmount - percentageDiscountAmount,
    )

    // --- Calculate end time based on dollar amount ---
    // Simple tier system: $0-300 = 2hr, $301-600 = 3hr, $601+ = 4hr
    const appointmentDuration = calculateAppointmentDurationFromTotal(subtotal)
    const buffered = applyAppointmentBuffer(appointmentDuration)
    const [sh, sm] = startTime.split(':').map(Number)
    if (!Number.isFinite(sh) || !Number.isFinite(sm)) {
      return NextResponse.json(
        { error: 'Please choose a valid appointment time.' },
        { status: 400, headers: CORS },
      )
    }
    const endTotal = sh * 60 + sm + buffered
    const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}:00`

    const now = new Date()
    const todayMT = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
    if (appointmentDate < todayMT) {
      return NextResponse.json(
        { error: 'Please choose a future appointment date.' },
        { status: 409, headers: CORS },
      )
    }

    const currentTimeMT = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Denver',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)
    const minStartMinutes =
      appointmentDate === todayMT
        ? timeToMinutes(currentTimeMT) + MINIMUM_SAME_DAY_LEAD_MINUTES
        : undefined

    const requestedStart = `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}:00`

    const staffResult = await getStaffPrioritizedSlots({
      supabase,
      date: appointmentDate,
      requiredMinutes: buffered,
      minStartMinutes,
      maxResults: 8,
    })

    const slotIsStillAvailable =
      staffResult !== null &&
      staffResult.slots.some((slot) => slot.start_time === requestedStart)

    if (!slotIsStillAvailable) {
      return NextResponse.json(
        {
          error:
            'That time is no longer available. Please pick another appointment time.',
        },
        { status: 409, headers: CORS },
      )
    }

    const assignedStaffUserId = staffResult?.staffUserId ?? null

    // --- Determine appointment status ---
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
        ...leadSourceUpdatePayload(normalizedLeadSource.source),
        kind: 'service',
        assigned_staff_user_id: assignedStaffUserId,
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
        percentage_discount_label: rugDiscountEligible
          ? requestedPercentageDiscount.label
          : null,
        percentage_discount_percent: rugDiscountEligible
          ? requestedPercentageDiscount.percent
          : 0,
        percentage_discount_scope: rugDiscountEligible
          ? requestedPercentageDiscount.scope
          : null,
        percentage_discount_amount: percentageDiscountAmount,
        discount_metadata: rugDiscountEligible
          ? {
              multi_rug: {
                rug_units: rugUnitCount,
                rug_subtotal: Number(
                  percentageDiscountScopeSubtotal.toFixed(2),
                ),
              },
            }
          : {},
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
      service_catalog_item_id: item.service_catalog_item_id ?? null,
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
      : serviceAreaCheck.travelCharge > 0
        ? `Appointment created via sasquatch.com booking widget ($${serviceAreaCheck.travelCharge} travel fee applied)`
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
      ...(serviceAreaCheck.travelCharge > 0
        ? [`Travel-charge area - $${serviceAreaCheck.travelCharge} travel fee`]
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
  ${serviceAreaCheck.travelCharge > 0 ? `<p style="color:#f59e0b;font-weight:600;margin:0 0 12px;">Travel-charge area - $${serviceAreaCheck.travelCharge} travel fee applied</p>` : ''}
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
        discount_applied: discountAmount + percentageDiscountAmount,
        percentage_discount_applied: percentageDiscountAmount,
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
