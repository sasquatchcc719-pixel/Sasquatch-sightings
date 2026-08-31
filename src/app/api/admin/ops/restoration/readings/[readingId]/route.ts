import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Correct or remove one moisture reading.
 *
 * Readings are typed on a phone, one-handed, in a wet basement. A 340 where 34
 * was meant does not just look wrong — it rescales the drying chart, drags the
 * trend, and goes into the report an adjuster reads. Until now the only remedy
 * was deleting the whole point and losing every reading on it.
 *
 * Refused once the project is closed: at that point the readings back an
 * invoice and a delivered report, and changing them is a correction to that
 * document rather than a typo fix.
 */
async function loadReading(supabase: ReturnType<typeof createAdminClient>, readingId: string) {
  const { data } = await supabase
    .from('restoration_readings')
    .select('id, value, reading_point_id, restoration_reading_points(project_id)')
    .eq('id', readingId)
    .maybeSingle()
  if (!data) return null

  const point = Array.isArray(data.restoration_reading_points)
    ? data.restoration_reading_points[0]
    : data.restoration_reading_points
  const projectId = (point as { project_id?: string } | null)?.project_id
  if (!projectId) return null

  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id, closed_at')
    .eq('id', projectId)
    .maybeSingle()

  return { reading: data, closed: Boolean(project?.closed_at) }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ readingId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { readingId } = await params
    const supabase = createAdminClient()
    const body = await request.json()

    const value = Number(body.value)
    if (!Number.isFinite(value) || value < 0) {
      return NextResponse.json({ error: 'value must be zero or more' }, { status: 400 })
    }

    const found = await loadReading(supabase, readingId)
    if (!found) return NextResponse.json({ error: 'reading_not_found' }, { status: 404 })
    if (found.closed) {
      return NextResponse.json({ error: 'project_is_closed' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('restoration_readings')
      .update({ value })
      .eq('id', readingId)
      .select('id, value, taken_at')
      .single()

    if (error) throw error
    return NextResponse.json({ reading: data })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to update reading'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ readingId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { readingId } = await params
    const supabase = createAdminClient()

    const found = await loadReading(supabase, readingId)
    if (!found) return NextResponse.json({ ok: true })
    if (found.closed) {
      return NextResponse.json({ error: 'project_is_closed' }, { status: 409 })
    }

    const { error } = await supabase
      .from('restoration_readings')
      .delete()
      .eq('id', readingId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove reading'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
