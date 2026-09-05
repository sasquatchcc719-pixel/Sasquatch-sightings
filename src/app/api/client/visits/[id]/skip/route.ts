import { NextRequest, NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { formatTime } from '@/lib/ops/client-portal'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/client/visits/[id]/skip
 * Cancel a single upcoming visit ("building closed that day"). This is the one
 * direct schedule action a client_manager may take — it only frees a slot, so it
 * can never double-book. Logged as a 'done' skip_visit request and Telegrammed to
 * Charles. Only future, still-active visits owned by this client can be skipped.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { user, client } = await requireClientManager()
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const { data: agreements, error: agreementError } = await supabase
      .from('ops_commercial_agreements')
      .select('id')
      .eq('customer_id', client.customer_id)
      .eq('status', 'signed')
      .limit(1)
    if (agreementError) throw agreementError
    if (agreements?.length)
      return NextResponse.json(
        {
          error:
            'Please use Request a change → Request cancellation so we can review the notice and payment terms in your agreement.',
        },
        { status: 409 },
      )
    const reason =
      typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null

    const { data: appt } = await supabase
      .from('ops_appointments')
      .select('id, customer_id, appointment_date, start_time, status')
      .eq('id', id)
      .maybeSingle()

    if (!appt || appt.customer_id !== client.customer_id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const today = new Date().toISOString().slice(0, 10)
    if (appt.appointment_date < today) {
      return NextResponse.json(
        { error: 'That visit is in the past and cannot be skipped.' },
        { status: 400 },
      )
    }
    if (!['booked', 'confirmed'].includes(appt.status)) {
      return NextResponse.json(
        { error: 'Only upcoming, active visits can be skipped.' },
        { status: 400 },
      )
    }

    // Cancel just this occurrence. Sibling visits and the template are untouched.
    const { error: updErr } = await supabase
      .from('ops_appointments')
      .update({
        status: 'cancelled',
        client_note: reason
          ? `[Skipped by client] ${reason}`
          : '[Skipped by client]',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (updErr) throw updErr

    // Audit trail on the appointment.
    await supabase.from('ops_appointment_status_events').insert({
      appointment_id: id,
      from_status: appt.status,
      to_status: 'cancelled',
      changed_by: user.id,
      notes: `Skipped by client manager ${client.display_name}${reason ? `: ${reason}` : ''}`,
    })

    // Log to the client activity feed (already executed → status 'done').
    await supabase.from('ops_client_change_requests').insert({
      customer_id: client.customer_id,
      requested_by_user_id: user.id,
      requested_by_name: client.display_name,
      appointment_id: id,
      request_type: 'skip_visit',
      status: 'done',
      message: reason,
      details: {
        appointment_date: appt.appointment_date,
        start_time: appt.start_time,
      },
      resolved_at: new Date().toISOString(),
    })

    const dateLabel = new Date(
      `${appt.appointment_date}T00:00:00`,
    ).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

    await sendTelegramNotification(
      `🚫 *VISIT SKIPPED — ${client.display_name}*

📅 ${dateLabel} at ${formatTime(appt.start_time)}${reason ? `\n💬 "${reason}"` : ''}

This visit was cancelled by the client and will not be billed. No action needed unless you want to follow up.`,
      { parseMode: 'Markdown' },
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 500
    return NextResponse.json({ error: 'Failed to skip visit' }, { status })
  }
}
