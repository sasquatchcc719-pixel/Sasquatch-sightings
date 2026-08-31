import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

const DEFAULT_MONITOR_MINUTES = 30

/**
 * Add another monitor visit to a job that needs more days.
 *
 * Three monitors is the starting guess, not a promise. A closet that stalls, a
 * subfloor that will not give it up, a customer who turned the equipment off
 * over the weekend — any of them means a fourth or fifth visit, and until now
 * there was no way to add one. The count was fixed at whatever was chosen on
 * day one.
 *
 * It joins the queue rather than the calendar, because a monitor has to be
 * fitted around carpet cleaning work by hand — the same tray every other
 * monitor is dragged out of.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))

    const { data: project } = await supabase
      .from('restoration_projects')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 })
    if (project.status !== 'active') {
      return NextResponse.json({ error: 'project_not_active' }, { status: 409 })
    }

    // Next in line after everything the job already has, queued or scheduled,
    // so sequence numbers stay unique even though the list is read by date.
    const [{ data: queued }, { data: scheduled }] = await Promise.all([
      supabase
        .from('restoration_visit_queue')
        .select('visit_sequence')
        .eq('project_id', id),
      supabase
        .from('ops_appointments')
        .select('visit_sequence')
        .eq('restoration_project_id', id),
    ])

    const highest = [...(queued ?? []), ...(scheduled ?? [])].reduce(
      (max, row) => Math.max(max, Number(row.visit_sequence ?? 0)),
      0,
    )

    const durationMinutes = Math.max(
      15,
      Math.min(240, Number(body.duration_minutes ?? DEFAULT_MONITOR_MINUTES)),
    )

    const { data, error } = await supabase
      .from('restoration_visit_queue')
      .insert({
        project_id: id,
        visit_type: 'monitor',
        visit_sequence: highest + 1,
        duration_minutes: durationMinutes,
        status: 'queued',
      })
      .select('id, visit_type, visit_sequence, duration_minutes, status')
      .single()

    if (error) throw error
    return NextResponse.json({ queued: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to add a monitor visit'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
