import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * The monitoring note for one visit.
 *
 * Readings say the numbers moved. The note says the closet still smells, the
 * customer moved a fan, the carpet came up in the corner — the things a carrier
 * reads to understand why a job took five days rather than three.
 *
 * Deliberately separate from `internal_notes`, which is dispatch scratch and
 * never leaves the office. This is written to be read by someone else.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const raw = typeof body.note === 'string' ? body.note.trim() : ''
    const note = raw === '' ? null : raw

    const { data: appointment } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!appointment?.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('ops_appointments')
      .update({ restoration_visit_note: note })
      .eq('id', appointmentId)
      .select('id, restoration_visit_note')
      .single()

    if (error) throw error
    return NextResponse.json({ visit: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to save the note'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
