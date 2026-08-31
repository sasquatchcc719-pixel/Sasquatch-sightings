import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadVisitFacts, draftVisitNote } from '@/lib/ops/restoration-visit-note'

/**
 * Turn what was said into the day's note.
 *
 * Drafts only. Nothing is saved here — the note comes back into the box for
 * Charles to read and change before it becomes the record. A model that writes
 * straight into a document an adjuster reads is a model nobody checked.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { appointmentId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const transcript = String(body.transcript ?? '')
    if (!transcript.trim()) {
      return NextResponse.json({ error: 'Nothing was said' }, { status: 400 })
    }

    const { data: visit } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id')
      .eq('id', appointmentId)
      .maybeSingle()
    if (!visit?.restoration_project_id) {
      return NextResponse.json({ error: 'not_a_restoration_visit' }, { status: 409 })
    }

    const facts = await loadVisitFacts(supabase, {
      projectId: visit.restoration_project_id,
      appointmentId,
    })
    if (!facts) return NextResponse.json({ error: 'visit_not_found' }, { status: 404 })

    const draft = await draftVisitNote(facts, transcript)
    if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 502 })

    return NextResponse.json({ note: draft.note })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to draft the note'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
