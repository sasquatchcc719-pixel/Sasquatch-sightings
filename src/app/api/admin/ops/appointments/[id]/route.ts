import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  applyAppointmentBuffer,
  calculateLineItemDurationMinutes,
} from '@/lib/ops/availability'
import {
  getOnMyWaySmsRenderedBody,
  sendOpsLifecycleCommunications,
} from '@/lib/ops/communications'
import { enrollCustomerInDrip } from '@/lib/ops/drip-campaign'
import { getQuickBooksSyncStatus } from '@/lib/quickbooks'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { sendCustomerSMS } from '@/lib/twilio'
import { Resend } from 'resend'

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

/** Normalize any "HH:MM" or "HH:MM:SS" input for Postgres time columns. */
function toDbTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim())
  if (!m) return '09:00:00'
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function parseClockMinutes(value: string): number {
  const [h, m] = toDbTime(value).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
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

    const normStartStr = (t: string) => toDbTime(t).slice(0, 5)
    const nextStartDb = toDbTime(
      body.start_time != null
        ? String(body.start_time)
        : String(current.start_time),
    )

    const startChanged =
      body.start_time != null &&
      normStartStr(String(body.start_time)) !==
        normStartStr(String(current.start_time))
    const dateChanged =
      body.appointment_date != null &&
      String(body.appointment_date).trim() !== String(current.appointment_date)

    const totalMinutesFromLines = (
      current.ops_appointment_line_items || []
    ).reduce(
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
    const totalMinutesWithBuffer = applyAppointmentBuffer(totalMinutesFromLines)

    const explicitEndInput =
      typeof body.end_time === 'string' && String(body.end_time).trim() !== ''
    const recalcFromLines = body.recalculate_end_from_line_items === true

    let nextEndDb: string
    if (recalcFromLines && totalMinutesFromLines > 0) {
      nextEndDb = addMinutesToTime(
        nextStartDb.slice(0, 5),
        totalMinutesWithBuffer,
      )
    } else if (explicitEndInput) {
      nextEndDb = toDbTime(String(body.end_time))
      if (parseClockMinutes(nextEndDb) <= parseClockMinutes(nextStartDb)) {
        return NextResponse.json(
          { error: 'End time must be after start time' },
          { status: 400 },
        )
      }
    } else if (startChanged || dateChanged) {
      const delta =
        parseClockMinutes(String(current.end_time)) -
        parseClockMinutes(String(current.start_time))
      const safeDelta = Math.max(delta, 15)
      nextEndDb = addMinutesToTime(nextStartDb.slice(0, 5), safeDelta)
    } else {
      nextEndDb = toDbTime(String(current.end_time))
    }

    const nextStatus = body.status ? String(body.status) : current.status
    const nextPaymentStatus = body.payment_status
      ? String(body.payment_status)
      : current.payment_status

    const nowIso = new Date().toISOString()
    const firstOnMyWayAt =
      (current as { on_my_way_at?: string | null }).on_my_way_at ?? null
    const completedAtExisting =
      (current as { completed_at?: string | null }).completed_at ?? null

    const nextOnMyWayAt =
      nextStatus === 'on_my_way' && !firstOnMyWayAt ? nowIso : firstOnMyWayAt
    const nextCompletedAt =
      nextStatus === 'completed' && !completedAtExisting
        ? nowIso
        : completedAtExisting

    const { data: updated, error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        appointment_date: appointmentDate,
        start_time: nextStartDb,
        end_time: nextEndDb,
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
        on_my_way_at: nextOnMyWayAt,
        completed_at: nextCompletedAt,
        updated_at: nowIso,
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

    let lifecycleNotifications: {
      template_key: string
      channel: 'sms' | 'email'
      body: string
      actually_sent?: boolean
    }[] = []

    if (current.status !== nextStatus) {
      if (nextStatus === 'on_my_way') {
        const { sent } = await sendOpsLifecycleCommunications({
          event: 'on_my_way',
          appointmentId: id,
        })
        lifecycleNotifications = sent.map((n) => ({
          ...n,
          actually_sent:
            n.channel === 'sms' ? (n.actually_sent ?? true) : undefined,
        }))
        const hasSms = lifecycleNotifications.some((n) => n.channel === 'sms')
        if (!hasSms) {
          const previewBody = await getOnMyWaySmsRenderedBody(id)
          if (previewBody != null) {
            lifecycleNotifications.push({
              template_key: 'on_my_way_sms',
              channel: 'sms',
              body: previewBody,
              actually_sent: false,
            })
          }
        }
      } else if (nextStatus === 'completed') {
        const { sent } = await sendOpsLifecycleCommunications({
          event: 'job_finished',
          appointmentId: id,
        })
        lifecycleNotifications = sent

        // Enroll in drip campaign (skip recurring/batch jobs like Recovery Village)
        const { data: apptMeta } = await supabase
          .from('ops_appointments')
          .select('recurring_template_id')
          .eq('id', id)
          .single()
        if (!apptMeta?.recurring_template_id) {
          enrollCustomerInDrip(id).catch((err) =>
            console.error('[drip] enrollment error:', err),
          )
        }
      }
    }

    if (nextStatus === 'completed') {
      const { data: inv } = await supabase
        .from('ops_invoices')
        .select('id, status')
        .eq('appointment_id', id)
        .maybeSingle()

      if (inv?.status === 'draft') {
        await supabase
          .from('ops_invoices')
          .update({
            status: 'ready',
            sync_status: getQuickBooksSyncStatus(),
            updated_at: nowIso,
          })
          .eq('id', inv.id)
        await supabase.from('ops_invoice_status_events').insert({
          invoice_id: inv.id,
          from_status: 'draft',
          to_status: 'ready',
          changed_by: access.id,
          notes: 'Job completed from operations',
        })
      }

      void syncAppointmentToQuickBooks(id).catch((qbErr) =>
        console.error('[ops/appointments/:id][PATCH] QB sync:', qbErr),
      )
    }

    return NextResponse.json({
      appointment: updated,
      lifecycle_notifications: lifecycleNotifications,
    })
  } catch (error) {
    console.error('[ops/appointments/:id][PATCH] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update appointment' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params

    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        start_time,
        ops_customers (
          full_name,
          first_name,
          email,
          phone
        ),
        ops_service_addresses (
          street_1,
          city,
          state,
          zip_code
        )
      `,
      )
      .eq('id', id)
      .single()

    if (appointmentError) throw appointmentError

    // Send cancellation notifications before deleting
    const customer = Array.isArray(appointment.ops_customers)
      ? appointment.ops_customers[0]
      : appointment.ops_customers
    const address = Array.isArray(appointment.ops_service_addresses)
      ? appointment.ops_service_addresses[0]
      : appointment.ops_service_addresses

    if (customer) {
      const firstName =
        customer.first_name || customer.full_name?.split(' ')[0] || 'there'
      const dateStr = appointment.appointment_date
      const addressStr = address ? `${address.street_1}, ${address.city}` : ''

      const smsBody = [
        `Hi ${firstName} — your Sasquatch Carpet Cleaning appointment`,
        dateStr ? ` on ${dateStr}` : '',
        addressStr ? ` at ${addressStr}` : '',
        ` has been cancelled.`,
        `\n\nTo rebook, visit sasquatchcarpet.com or call/text us at (719) 249-8791.`,
      ].join('')

      const notifications: Promise<unknown>[] = []

      if (customer.phone) {
        notifications.push(
          sendCustomerSMS(customer.phone, smsBody, undefined, 'job_cancelled'),
        )
      }

      if (customer.email) {
        const resendKey = process.env.RESEND_API_KEY
        if (resendKey) {
          const resend = new Resend(resendKey)
          const fromEmail =
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
          notifications.push(
            resend.emails.send({
              from: fromEmail,
              to: customer.email,
              subject:
                'Your Sasquatch Carpet Cleaning appointment has been cancelled',
              html: `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
  <h2 style="color:#16a34a;">Appointment Cancelled</h2>
  <p>Hi ${firstName},</p>
  <p>Your appointment${dateStr ? ` on <strong>${dateStr}</strong>` : ''}${addressStr ? ` at ${addressStr}` : ''} has been cancelled.</p>
  <p>We apologize for any inconvenience. To rebook, visit our website or give us a call.</p>
  <a href="https://sasquatchcarpet.com" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#16a34a;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Rebook Now</a>
  <p style="margin-top:20px;color:#6b7280;font-size:13px;">Questions? Call or text us at (719) 249-8791.</p>
</div>`,
            }),
          )
        }
      }

      await Promise.allSettled(notifications)
    }

    const { data: invoices, error: invoicesError } = await supabase
      .from('ops_invoices')
      .select('id')
      .eq('appointment_id', id)

    if (invoicesError) throw invoicesError

    const invoiceIds = (invoices || []).map((row) => row.id)
    if (invoiceIds.length > 0) {
      const { error: syncCleanupError } = await supabase
        .from('ops_quickbooks_sync_jobs')
        .delete()
        .eq('entity_type', 'invoice')
        .in('entity_id', invoiceIds)
      if (syncCleanupError) throw syncCleanupError
    }

    const { error: deleteError } = await supabase
      .from('ops_appointments')
      .delete()
      .eq('id', id)

    if (deleteError) throw deleteError

    return NextResponse.json({
      success: true,
      appointment_id: appointment.id,
    })
  } catch (error) {
    console.error('[ops/appointments/:id][DELETE] Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete appointment' },
      { status: 500 },
    )
  }
}
