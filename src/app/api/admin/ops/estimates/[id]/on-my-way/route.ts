import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'

/**
 * "On my way" for an estimate visit. Mirrors the job-screen quick action:
 * flips the estimate to on_my_way, stamps on_my_way_at, and texts the
 * customer the estimate-specific arrival message. POST { undo: true } puts
 * it back to confirmed without texting anyone.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      undo?: boolean
    }
    const supabase = createAdminClient()

    const { data: current, error: loadError } = await supabase
      .from('ops_appointments')
      .select('id, status, on_my_way_at, converted_appointment_id')
      .eq('id', id)
      .eq('kind', 'estimate')
      .maybeSingle()
    if (loadError) throw loadError
    if (!current) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const undo = body.undo === true
    const nextStatus = undo ? 'confirmed' : 'on_my_way'
    if (
      current.converted_appointment_id ||
      !['scheduled', 'booked', 'confirmed', 'on_my_way'].includes(
        current.status,
      )
    ) {
      return NextResponse.json(
        {
          error:
            'This estimate visit is no longer scheduled. Refresh the estimate before continuing.',
        },
        { status: 409 },
      )
    }
    if (
      current.status === nextStatus ||
      (undo && current.status !== 'on_my_way')
    ) {
      return NextResponse.json({ ok: true, status: current.status, sms: null })
    }
    const now = new Date().toISOString()

    const { data: updated, error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        status: nextStatus,
        on_my_way_at: undo ? null : current.on_my_way_at || now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('kind', 'estimate')
      .eq('status', current.status)
      .is('converted_appointment_id', null)
      .select('id')
      .maybeSingle()
    if (updateError) throw updateError
    if (!updated) {
      return NextResponse.json(
        {
          error:
            'This estimate changed in another session. Refresh before trying again.',
        },
        { status: 409 },
      )
    }

    if (current.status !== nextStatus) {
      await supabase.from('ops_appointment_status_events').insert({
        appointment_id: id,
        from_status: current.status,
        to_status: nextStatus,
        changed_by: access.id,
        notes: undo
          ? 'Estimate visit back to scheduled'
          : 'On my way to estimate visit',
      })
    }

    let sms: { body: string } | null = null
    let warning: string | null = null
    if (!undo) {
      try {
        const { sent } = await sendOpsLifecycleCommunications({
          event: 'on_my_way',
          appointmentId: id,
        })
        const smsSent = sent.find(
          (n) => n.channel === 'sms' && n.actually_sent === true,
        )
        sms = smsSent ? { body: smsSent.body } : null
        if (!sms)
          warning =
            'You are marked on the way, but no customer text was sent. Check the saved phone number and messaging settings; contact the customer directly.'
      } catch (error) {
        console.error('[ops/estimates/:id/on-my-way] SMS failed:', error)
        warning =
          'You are marked on the way, but the customer text could not be confirmed. Contact the customer directly or check message history before retrying.'
      }
    }

    return NextResponse.json({ ok: true, status: nextStatus, sms, warning })
  } catch (error) {
    // An expired session throws here. Say so plainly instead of a generic
    // failure, so a tech in a driveway knows to log back in.
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json(
        { error: 'Your session expired. Log in again and retry.' },
        { status: 401 },
      )
    }
    console.error('[ops/estimates/:id/on-my-way] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update on-my-way status' },
      { status: 500 },
    )
  }
}
