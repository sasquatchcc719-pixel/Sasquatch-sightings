/**
 * Canvassing GPS breadcrumb ingestion. Batched by the client (~30s cadence).
 * Points only land on a session the caller owns and that is still active.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { haversineDistance } from '@/lib/gps/haversine'

/** How long after Stop a session still accepts a trailing/offline flush. */
const LATE_POINT_GRACE_MS = 10 * 60 * 1000

type IncomingPoint = {
  lat: number
  lng: number
  accuracyM?: number | null
  speedMps?: number | null
  recordedAt: string
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
  const sessionId = String(body.sessionId ?? '')
  const points: IncomingPoint[] = Array.isArray(body.points) ? body.points : []

  if (!sessionId || points.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  // Accept points for a session the caller owns. A just-stopped session still
  // takes stragglers for a short grace period: the client's final flush (and
  // any batch that was stashed offline) would otherwise be rejected and the
  // tail of the walk lost.
  const { data: session } = await supabase
    .from('canvass_sessions')
    .select('id, status, ended_at')
    .eq('id', sessionId)
    .eq('user_id', access.id)
    .maybeSingle()
  if (!session) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 403 })
  }
  if (session.status !== 'active') {
    const endedAt = session.ended_at ? Date.parse(session.ended_at) : 0
    if (!endedAt || Date.now() - endedAt > LATE_POINT_GRACE_MS) {
      return NextResponse.json({ error: 'Session closed' }, { status: 409 })
    }
  }

  const rows = points
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        typeof p.recordedAt === 'string',
    )
    .map((p) => ({
      session_id: sessionId,
      lat: p.lat,
      lng: p.lng,
      accuracy_m: p.accuracyM ?? null,
      speed_mps: p.speedMps ?? null,
      recorded_at: p.recordedAt,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 })
  }

  const { error } = await supabase.from('canvass_points').insert(rows)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // For an active session, point_count and distance are finalized at stop
  // time. A late batch landing after stop has to refresh them itself, or the
  // walk's totals stay stuck at whatever they were mid-flush.
  if (session.status !== 'active') {
    const { data: all } = await supabase
      .from('canvass_points')
      .select('lat, lng')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true })
    const pts = all ?? []
    let distance = 0
    for (let i = 1; i < pts.length; i++) {
      distance += haversineDistance(
        pts[i - 1].lat,
        pts[i - 1].lng,
        pts[i].lat,
        pts[i].lng,
      )
    }
    await supabase
      .from('canvass_sessions')
      .update({ point_count: pts.length, distance_m: Math.round(distance) })
      .eq('id', sessionId)
  }

  return NextResponse.json({ ok: true, inserted: rows.length })
}
