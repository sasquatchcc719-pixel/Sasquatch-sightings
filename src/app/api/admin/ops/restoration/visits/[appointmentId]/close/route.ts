import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Mark a restoration visit done.
 *
 * A monitor visit is half an hour of readings. The normal chain — on my way,
 * start work, finish visit — is three taps to record that nothing happened
 * worth three taps, so in practice the visit sits on "on my way" forever and
 * the schedule stops telling the truth about what has been done.
 *
 * Deliberately quiet. No customer message, no invoice: a restoration visit
 * never bills on its own, and the whole loss invoices once at the close.
 * Sending someone a text because a status changed is not a default worth
 * having — the finished-visit wording exists and can be switched on.
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
    return NextResponse.json({ visit: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to close the visit'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
