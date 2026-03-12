import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

const APPOINTMENT_SELECT = `
  *,
  ops_customers (
    id,
    full_name,
    first_name,
    last_name,
    business_name,
    email,
    phone,
    notes
  ),
  ops_service_addresses (
    id,
    label,
    street_1,
    street_2,
    city,
    state,
    zip_code,
    gate_code,
    notes
  ),
  ops_appointment_line_items (
    id,
    service_catalog_item_id,
    name_snapshot,
    quantity,
    unit_price,
    duration_minutes,
    buffer_minutes,
    line_total,
    notes
  ),
  ops_invoices (
    id,
    status,
    payment_status,
    sync_status,
    subtotal,
    total,
    quickbooks_invoice_id,
    ops_invoice_line_items (
      id,
      appointment_line_item_id,
      description,
      quantity,
      unit_price,
      line_total
    )
  )
`

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data, error } = await supabase
      .from('ops_appointments')
      .select(APPOINTMENT_SELECT)
      .eq('id', id)
      .single()

    if (error) throw error

    return NextResponse.json({ appointment: data })
  } catch (error) {
    console.error('[ops/appointments/:id][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load appointment' },
      { status: 500 },
    )
  }
}

export async function PATCH(
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
    const { id } = await params
    const body = await request.json()

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          *,
          ops_appointment_line_items (
            duration_minutes,
            buffer_minutes,
            quantity
          )
        `,
      )
      .eq('id', id)
      .single()

    if (currentError) throw currentError

    const appointmentDate = body.appointment_date
      ? String(body.appointment_date).trim()
      : current.appointment_date
    const startTime = body.start_time
      ? String(body.start_time).trim()
      : String(current.start_time).slice(0, 5)

    const totalMinutes = (current.ops_appointment_line_items || []).reduce(
      (
        sum: number,
        item: {
          duration_minutes: number
          buffer_minutes: number
          quantity: number
        },
      ) =>
        sum +
        calculateLineItemDurationMinutes({
          durationMinutes: Number(item.duration_minutes),
          quantity: Number(item.quantity),
        }),
      0,
    )
    const totalMinutesWithBuffer = applyAppointmentBuffer(totalMinutes)

    const nextStatus = body.status ? String(body.status) : current.status
    const nextPaymentStatus = body.payment_status
      ? String(body.payment_status)
      : current.payment_status

    const { data: updated, error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        appointment_date: appointmentDate,
        start_time: `${startTime}:00`.slice(0, 8),
        end_time: addMinutesToTime(startTime, totalMinutesWithBuffer),
        status: nextStatus,
        payment_status: nextPaymentStatus,
        internal_notes:
          body.internal_notes !== undefined
            ? String(body.internal_notes || '').trim() || null
            : current.internal_notes,
        assigned_staff_user_id:
          body.assigned_staff_user_id !== undefined
            ? body.assigned_staff_user_id || null
            : current.assigned_staff_user_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) throw updateError

    if (
      current.status !== nextStatus ||
      current.payment_status !== nextPaymentStatus
    ) {
      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: id,
        from_status: current.status,
        to_status: nextStatus,
        changed_by: access.id,
        notes: 'Appointment updated from operations job detail',
      })
    }

    if (current.status !== nextStatus) {
      if (nextStatus === 'on_my_way') {
        await sendOpsLifecycleCommunications({
          event: 'on_my_way',
          appointmentId: id,
        })
      } else if (nextStatus === 'completed') {
        await sendOpsLifecycleCommunications({
          event: 'job_finished',
          appointmentId: id,
        })
      }
    }

    return NextResponse.json({ appointment: updated })
  } catch (error) {
    console.error('[ops/appointments/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update appointment' },
      { status: 500 },
    )
  }
}
