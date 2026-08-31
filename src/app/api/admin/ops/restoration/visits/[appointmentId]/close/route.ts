import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'

/**
 * Mark a restoration visit done.
 *
 * A monitor visit is half an hour of readings. The normal chain — on my way,
 * start work, finish visit — is three taps to record that nothing happened
 * worth three taps, so in practice the visit sits on "on my way" forever and
 * the schedule stops telling the truth about what has been done.
 *
 * No invoice: a restoration visit never bills on its own, and the whole loss
 * invoices once at the project close.
 *
 * It does text the customer, which Charles asked for — the monitor wording says
 * what was done and that the equipment stays running, which is the question a
 * customer with fans in their basement actually has. The message is sent only on
 * the transition: closing an already-closed visit sends nothing, so tapping the
 * button twice does not text somebody twice.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()

    const { data: visit } = await supabase
      .from('ops_appointments')
      .select('id, status, restoration_project_id')
      .eq('id', appointmentId)
      .maybeSingle()

    if (!visit?.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }
    if (visit.status === 'completed') {
      return NextResponse.json({ visit, already: true })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('ops_appointments')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .eq('id', appointmentId)
      .select('id, status, completed_at')
      .single()

    if (error) throw error

    // Only on the transition — the early return above covers a second tap.
    const { sent } = await sendOpsLifecycleCommunications({
      event: 'job_finished',
      appointmentId,
    })

    return NextResponse.json({ visit: data, sent })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close the visit'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
