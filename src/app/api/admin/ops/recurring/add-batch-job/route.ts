import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { applyAppointmentBuffer } from '@/lib/ops/availability'

/**
 * POST /api/admin/ops/recurring/add-batch-job
 *
 * Creates a one-off appointment tagged for batch billing so it appears in
 * the Month-End Billing card alongside recurring visits.
 *
 * Body: {
 *   customerId: string
 *   serviceAddressId: string
 *   appointmentDate: string   // YYYY-MM-DD
 *   startTime: string         // HH:MM
 *   lineItems: Array<{
 *     name_snapshot: string
 *     notes?: string
 *     quantity: number
 *     unit_price: number
 *     duration_minutes: number
 *   }>
 *   internalNotes?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json()

    const {
      customerId,
      serviceAddressId,
      appointmentDate,
      startTime,
      lineItems,
      internalNotes,
    } = body as {
      customerId: string
      serviceAddressId: string
      appointmentDate: string
      startTime: string
      lineItems: Array<{
        service_catalog_item_id?: string | null
        name_snapshot: string
        notes?: string
        quantity: number
        unit_price: number
        duration_minutes: number
      }>
      internalNotes?: string
    }

    if (
      !customerId ||
      !serviceAddressId ||
      !appointmentDate ||
      !startTime ||
      !lineItems?.length
    ) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 },
      )
    }

    const totalMinutes = lineItems.reduce(
      (s, l) => s + l.duration_minutes * l.quantity,
      0,
    )
    const bufferedMinutes = applyAppointmentBuffer(totalMinutes || 60)

    const normalizedStart = `${startTime}:00`.slice(0, 8)
    const startParts = startTime.split(':').map(Number)
    const endTotal = startParts[0] * 60 + startParts[1] + bufferedMinutes
    const endNorm = ((endTotal % 1440) + 1440) % 1440
    const endTime = `${String(Math.floor(endNorm / 60)).padStart(2, '0')}:${String(endNorm % 60).padStart(2, '0')}:00`

    const subtotal = lineItems.reduce(
      (s, l) => s + l.unit_price * l.quantity,
      0,
    )
    const quotedTotal = Math.max(0, subtotal)

    // Create the appointment tagged for batch billing
    const { data: appointment, error: apptErr } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: serviceAddressId,
        batch_billing_customer_id: customerId,
        recurring_template_id: null,
        booking_channel: 'admin',
        source: 'batch_billing_adhoc',
        status: 'booked',
        payment_status: 'unpaid',
        quickbooks_sync_status: 'held',
        appointment_date: appointmentDate,
        start_time: normalizedStart,
        end_time: endTime,
        quoted_total: Number(quotedTotal.toFixed(2)),
        internal_notes: internalNotes || null,
      })
      .select('id')
      .single()

    console.log('[add-batch-job] inserting appointment', {
      customerId,
      serviceAddressId,
      appointmentDate,
      start_time: normalizedStart,
      end_time: endTime,
      quotedTotal,
    })

    if (apptErr || !appointment) {
      console.error('[add-batch-job] appointment insert failed:', apptErr)
      return NextResponse.json(
        {
          error: apptErr?.message || 'Failed to create appointment',
          detail: apptErr?.details || null,
          hint: apptErr?.hint || null,
          code: apptErr?.code || null,
        },
        { status: 500 },
      )
    }

    // Create line items
    const linePayload = lineItems.map((l) => ({
      appointment_id: appointment.id,
      service_catalog_item_id: l.service_catalog_item_id || null,
      name_snapshot: l.name_snapshot,
      quantity: l.quantity,
      unit_price: l.unit_price,
      duration_minutes: l.duration_minutes,
      buffer_minutes: 0,
      line_total: Number((l.unit_price * l.quantity).toFixed(2)),
      notes: l.notes || null,
    }))

    const { error: lineErr } = await supabase
      .from('ops_appointment_line_items')
      .insert(linePayload)

    if (lineErr) {
      console.error('[add-batch-job] line item insert failed:', lineErr)
      // Clean up the orphaned appointment
      await supabase.from('ops_appointments').delete().eq('id', appointment.id)
      return NextResponse.json(
        {
          error: `Line item error: ${lineErr.message}`,
          detail: lineErr.details || null,
          hint: lineErr.hint || null,
          code: lineErr.code || null,
        },
        { status: 500 },
      )
    }

    // Status event
    const { error: eventErr } = await supabase
      .from('ops_appointment_status_events')
      .insert({
        appointment_id: appointment.id,
        from_status: null,
        to_status: 'booked',
        changed_by: null,
        notes: 'One-off job added to batch billing',
      })

    if (eventErr) {
      console.error('[add-batch-job] status event insert failed:', eventErr)
    }

    return NextResponse.json({
      appointmentId: appointment.id,
      appointmentDate,
      quotedTotal: Number(quotedTotal.toFixed(2)),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
