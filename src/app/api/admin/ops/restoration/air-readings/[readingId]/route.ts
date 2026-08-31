import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Correct or remove one atmospheric reading.
 *
 * Same reasoning as the moisture readings: these are typed in the field, they
 * drive the dehumidifier and dry-goal verdicts, and a wrong one produces a
 * confident wrong answer. Refused once the project is closed.
 */
async function loadReading(supabase: ReturnType<typeof createAdminClient>, readingId: string) {
  const { data } = await supabase
    .from('restoration_air_readings')
    .select('id, project_id')
    .eq('id', readingId)
    .maybeSingle()
  if (!data) return null

  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id, closed_at')
    .eq('id', data.project_id)
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

    const patch: Record<string, unknown> = {}
    if ('temp_f' in body) {
      const tempF = Number(body.temp_f)
      if (!Number.isFinite(tempF)) {
        return NextResponse.json({ error: 'temperature must be a number' }, { status: 400 })
      }
      patch.temp_f = tempF
    }
    if ('rh_pct' in body) {
      const rhPct = Number(body.rh_pct)
      if (!Number.isFinite(rhPct) || rhPct < 0 || rhPct > 100) {
        return NextResponse.json({ error: 'relative humidity must be 0-100' }, { status: 400 })
      }
      patch.rh_pct = rhPct
    }
    if ('location' in body) {
      const location = String(body.location ?? '').trim()
      if (!location) {
        return NextResponse.json({ error: 'label cannot be blank' }, { status: 400 })
      }
      patch.location = location
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const found = await loadReading(supabase, readingId)
    if (!found) return NextResponse.json({ error: 'reading_not_found' }, { status: 404 })
    if (found.closed) {
      return NextResponse.json({ error: 'project_is_closed' }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('restoration_air_readings')
      .update(patch)
      .eq('id', readingId)
      .select('id, role, location, temp_f, rh_pct, taken_at')
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
      .from('restoration_air_readings')
      .delete()
      .eq('id', readingId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove reading'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
