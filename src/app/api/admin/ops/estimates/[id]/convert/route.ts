import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import {
  buildQuickBooksCustomerPayload,
  buildQuickBooksInvoicePayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { scheduleJobReminder } from '@/lib/onesignal'

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

/**
 * Convert an estimate into a real service appointment + invoice.
 *
 * Body:
 *   { appointment_date, start_time, end_time?, skip_comms? }
 *
 * Effect:
 *   1. Creates a NEW ops_appointments row (kind='service') on the chosen date.
 *   2. Copies all line items from the estimate (length/width/notes preserved).
 *   3. Creates ops_invoices + ops_invoice_line_items.
 *   4. Fires QB sync + lifecycle comms + reminder (unless skip_comms=true).
 *   5. Sets estimate_status='converted' and converted_appointment_id on the
 *      original estimate. The measuring visit stays on the calendar.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id: estimateId } = await params
    const body = await request.json()

    const appointmentDate = String(body.appointment_date || '').trim()
    const startTime = String(body.start_time || '').trim()
    if (!appointmentDate || !startTime) {
      return NextResponse.json(
        { error: 'appointment_date and start_time are required' },
        { status: 400 },
      )
    }

    // --- Load the estimate (with lines) ---
    const { data: estimate, error: estimateError } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          kind,
          customer_id,
          service_address_id,
          estimate_status,
          converted_appointment_id,
          internal_notes,
          lead_source,
          ops_customers!ops_appointments_customer_id_fkey (
            id,
            full_name,
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
            id,
            service_catalog_item_id,
            name_snapshot,
            notes,
            quantity,
            unit_price,
            duration_minutes,
            buffer_minutes,
            line_total,
            length_value,
            width_value,
            pricing_unit_snapshot
          )
        `,
      )
      .eq('id', estimateId)
      .eq('kind', 'estimate')
      .single()

    if (estimateError) throw estimateError
    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    if (estimate.converted_appointment_id) {
      return NextResponse.json(
        {
          error: 'This estimate has already been converted.',
          existing_appointment_id: estimate.converted_appointment_id,
        },
        { status: 409 },
      )
    }

    const lineItems = estimate.ops_appointment_line_items || []
    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'Add at least one line item before converting' },
        { status: 400 },
      )
    }

    const customer = Array.isArray(estimate.ops_customers)
      ? estimate.ops_customers[0]
      : estimate.ops_customers
    const address = Array.isArray(estimate.ops_service_addresses)
      ? estimate.ops_service_addresses[0]
      : estimate.ops_service_addresses

    if (!customer || !address) {
      return NextResponse.json(
        { error: 'Estimate is missing customer or address' },
        { status: 400 },
      )
    }

    // --- Duration math for the real service visit ---
    const totalMinutes = lineItems.reduce(
      (sum: number, item) =>
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: Number(item.duration_minutes || 0),
          quantity: Number(item.quantity || 1),
          pricingUnit: item.pricing_unit_snapshot,
        }),
      0,
    )
    const totalMinutesWithBuffer = applyAppointmentBuffer(
      totalMinutes > 0 ? totalMinutes : 60,
    )

    const providedEndTime = body.end_time ? String(body.end_time) : null
    const endTime =
      providedEndTime && /^\d{2}:\d{2}/.test(providedEndTime)
        ? `${providedEndTime}:00`.slice(0, 8)
        : addMinutesToTime(startTime, totalMinutesWithBuffer)

    const subtotal = lineItems.reduce(
      (sum: number, item) => sum + Number(item.line_total || 0),
      0,
    )
    const discountAmount = Math.max(0, Number(body.discount_amount || 0))
    const total = Math.max(0, subtotal - discountAmount)
    const syncStatus = getQuickBooksSyncStatus()

    // --- Create the service appointment ---
    const { data: serviceAppt, error: serviceErr } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: estimate.customer_id,
        service_address_id: estimate.service_address_id,
        appointment_date: appointmentDate,
        start_time: `${startTime}:00`.slice(0, 8),
        end_time: endTime,
        status: 'booked',
        payment_status: 'unpaid',
        kind: 'service',
        booking_channel: 'admin',
        source: 'internal',
        quickbooks_sync_status: syncStatus,
        quoted_total: Number(total.toFixed(2)),
        internal_notes: estimate.internal_notes ?? null,
        lead_source: estimate.lead_source ?? null,
      })
      .select('id')
      .single()

    if (serviceErr) throw serviceErr

    // --- Copy line items onto the service appointment ---
    const appointmentLinesPayload = lineItems.map((item) => ({
      appointment_id: serviceAppt.id,
      service_catalog_item_id: item.service_catalog_item_id,
      name_snapshot: item.name_snapshot,
      notes: item.notes,
      quantity: item.quantity,
      unit_price: item.unit_price,
      duration_minutes: item.duration_minutes,
      buffer_minutes: item.buffer_minutes,
      line_total: item.line_total,
      length_value: item.length_value,
      width_value: item.width_value,
      pricing_unit_snapshot: item.pricing_unit_snapshot,
    }))

    const { data: appointmentLines, error: appointmentLinesError } =
      await supabase
        .from('ops_appointment_line_items')
        .insert(appointmentLinesPayload)
        .select('id, name_snapshot, quantity, unit_price, line_total')

    if (appointmentLinesError) throw appointmentLinesError

    // --- Create invoice ---
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .insert({
        appointment_id: serviceAppt.id,
        status: 'draft',
        payment_status: 'unpaid',
        subtotal: Number(subtotal.toFixed(2)),
        discount_amount: Number(discountAmount.toFixed(2)),
        total: Number(total.toFixed(2)),
        sync_status: syncStatus,
      })
      .select('id, subtotal, total')
      .single()

    if (invoiceError) throw invoiceError

    const invoiceLinesPayload = (appointmentLines || []).map((item) => ({
      invoice_id: invoice.id,
      appointment_line_item_id: item.id,
      description: item.name_snapshot,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
    }))

    if (invoiceLinesPayload.length > 0) {
      const { error: invoiceLinesError } = await supabase
        .from('ops_invoice_line_items')
        .insert(invoiceLinesPayload)
      if (invoiceLinesError) throw invoiceLinesError
    }

    // --- Status events + QB sync jobs ---
    await Promise.all([
      supabase.from('ops_appointment_status_events').insert({
        appointment_id: serviceAppt.id,
        from_status: null,
        to_status: 'booked',
        changed_by: access.id,
        notes: `Service appointment created from estimate ${estimateId}`,
      }),
      supabase.from('ops_invoice_status_events').insert({
        invoice_id: invoice.id,
        from_status: null,
        to_status: 'draft',
        changed_by: access.id,
        notes: 'Invoice created from converted estimate',
      }),
      supabase.from('ops_quickbooks_sync_jobs').insert([
        {
          entity_type: 'customer',
          entity_id: estimate.customer_id,
          status: syncStatus,
          payload: buildQuickBooksCustomerPayload({
            customerId: estimate.customer_id,
            fullName: customer.full_name || 'Customer',
            email: customer.email || null,
            phone: customer.phone || null,
            address: {
              street_1: address.street_1,
              street_2: address.street_2,
              city: address.city,
              state: address.state,
              zip_code: address.zip_code,
            },
          }),
        },
        {
          entity_type: 'invoice',
          entity_id: invoice.id,
          status: syncStatus,
          payload: buildQuickBooksInvoicePayload({
            invoiceId: invoice.id,
            customerId: estimate.customer_id,
            serviceDate: appointmentDate,
            subtotal: Number(invoice.subtotal),
            total: Number(invoice.total),
            lineItems: invoiceLinesPayload,
          }),
        },
      ]),
    ])

    // --- Mark the estimate as converted ---
    const { error: updateEstimateError } = await supabase
      .from('ops_appointments')
      .update({
        estimate_status: 'converted',
        converted_appointment_id: serviceAppt.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', estimateId)

    if (updateEstimateError) throw updateEstimateError

    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: estimateId,
      from_status: estimate.estimate_status,
      to_status: 'converted',
      changed_by: access.id,
      notes: `Converted to service appointment ${serviceAppt.id}`,
    })

    // --- Fire comms + QB (non-blocking) ---
    if (!body.skip_comms) {
      const [commsResult, qbResult] = await Promise.allSettled([
        sendOpsLifecycleCommunications({
          event: 'job_scheduled',
          appointmentId: serviceAppt.id,
        }),
        syncAppointmentToQuickBooks(serviceAppt.id),
        scheduleJobReminder({
          appointmentId: serviceAppt.id,
          appointmentDate,
          startTime: `${startTime}:00`.slice(0, 8),
          customerName: customer.full_name || 'Customer',
          address: `${address.street_1}, ${address.city}`,
        }),
      ])
      if (commsResult.status === 'rejected') {
        console.error(
          '[ops/estimates/:id/convert] Comms error:',
          commsResult.reason,
        )
      }
      if (qbResult.status === 'rejected') {
        console.error(
          '[ops/estimates/:id/convert] QB sync error:',
          qbResult.reason,
        )
      }
    }

    return NextResponse.json(
      {
        appointment_id: serviceAppt.id,
        invoice_id: invoice.id,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[ops/estimates/:id/convert][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to convert estimate' },
      { status: 500 },
    )
  }
}
