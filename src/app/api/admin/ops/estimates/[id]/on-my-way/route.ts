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
      .select('id, status, on_my_way_at')
      .eq('id', id)
      .eq('kind', 'estimate')
      .maybeSingle()
    if (loadError) throw loadError
    if (!current) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const undo = body.undo === true
    const nextStatus = undo ? 'confirmed' : 'on_my_way'
    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('ops_appointments')
      .update({
        status: nextStatus,
        on_my_way_at: undo ? null : current.on_my_way_at || now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('kind', 'estimate')
    if (updateError) throw updateError

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
    if (!undo) {
      const { sent } = await sendOpsLifecycleCommunications({
        event: 'on_my_way',
        appointmentId: id,
      })
      const smsSent = sent.find((n) => n.channel === 'sms')
      sms = smsSent ? { body: smsSent.body } : null
    }

    return NextResponse.json({ ok: true, status: nextStatus, sms })
  } catch (error) {
    console.error('[ops/estimates/:id/on-my-way] Error:', error)
    return NextResponse.json(
      { error: 'Failed to update on-my-way status' },
      { status: 500 },
    )
  }
}
