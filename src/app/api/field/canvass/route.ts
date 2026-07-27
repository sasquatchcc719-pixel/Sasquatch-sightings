/**
 * Canvassing session API (door-hanger route tracking).
 * GET  - the caller's active session, if any
 * POST - { action: 'start' } begin a session (closes any dangling active one)
 *        { action: 'stop' }  end the active session; computes distance
 *
 * Deliberately separate from gps_shifts/timesheets: canvassing is paid
 * busy-work between jobs and must never create payroll records.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { haversineDistance } from '@/lib/gps/haversine'

/**
 * An active session still receiving points within this window is treated as
 * the same walk in progress, so a second tab resumes it rather than forking.
 * Beyond it, the session is assumed abandoned and is closed out.
 */
const RESUME_WINDOW_MS = 30 * 60 * 1000

export async function GET() {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { data: session } = await supabase
      .from('canvass_sessions')
      .select('id, started_at, point_count')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return NextResponse.json({ session: session ?? null })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const body = await request.json()

  if (body.action === 'start') {
    // Starting is idempotent within a walk. Two tabs (or a reopened PWA)
    // used to each create their own session, which closed the other's — and
    // the still-running one then had every flush rejected, silently losing
    // whole streets. If an active session is still being fed points, hand
    // that same session back instead of forking a new one.
    const { data: existing } = await supabase
      .from('canvass_sessions')
      .select('id, started_at')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      const { data: lastPoint } = await supabase
        .from('canvass_points')
        .select('recorded_at')
        .eq('session_id', existing.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const lastActivity = Date.parse(
        lastPoint?.recorded_at ?? existing.started_at,
      )
      if (Date.now() - lastActivity < RESUME_WINDOW_MS) {
        return NextResponse.json({ session: existing, resumed: true })
      }
      // Genuinely stale (phone died mid-walk, forgotten stop) — close it out.
      await supabase
        .from('canvass_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', existing.id)
    }

    const { data: session, error } = await supabase
      .from('canvass_sessions')
      .insert({ user_id: access.id, status: 'active' })
      .select('id, started_at')
      .single()
    if (error || !session) {
      return NextResponse.json(
        { error: error?.message ?? 'Failed to start' },
        { status: 500 },
      )
    }
    return NextResponse.json({ session })
  }

  if (body.action === 'stop') {
    const { data: session } = await supabase
      .from('canvass_sessions')
      .select('id')
      .eq('user_id', access.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 404 })
    }

    const { data: points } = await supabase
      .from('canvass_points')
      .select('lat, lng')
      .eq('session_id', session.id)
      .order('recorded_at', { ascending: true })

    let distance = 0
    const pts = points ?? []
    for (let i = 1; i < pts.length; i++) {
      distance += haversineDistance(
        pts[i - 1].lat,
        pts[i - 1].lng,
        pts[i].lat,
        pts[i].lng,
      )
    }

    const { data: updated, error } = await supabase
      .from('canvass_sessions')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        point_count: pts.length,
        distance_m: Math.round(distance),
      })
      .eq('id', session.id)
      .select('id, started_at, ended_at, point_count, distance_m')
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ session: updated })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
