/**
 * Canvassing GPS breadcrumb ingestion. Batched by the client (~30s cadence).
 * Points only land on a session the caller owns and that is still active.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  CANVASS_AUTO_STOP_NOTE,
  DAVID_CANVASS_USER_ID,
  exceedsWalkingLimits,
} from '@/lib/gps/canvassAutoStop'
import { canvassTotals, readCanvassPoints } from '@/lib/gps/canvassSession'

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
    .select('id, status, ended_at, notes')
    .eq('id', sessionId)
    .eq('user_id', access.id)
    .maybeSingle()
  if (!session) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 403 })
  }
  if (session.notes === CANVASS_AUTO_STOP_NOTE) {
    return NextResponse.json({ ok: true, inserted: 0, autoStopped: true })
  }
  if (session.status !== 'active') {
    const endedAt = session.ended_at ? Date.parse(session.ended_at) : 0
    if (!endedAt || Date.now() - endedAt > LATE_POINT_GRACE_MS) {
      return NextResponse.json({ error: 'Session closed' }, { status: 409 })
    }
  }

  let stopAt: string | null = null
  let accepted = points
  if (access.id === DAVID_CANVASS_USER_ID) {
    let saved
    try {
      saved = await readCanvassPoints(supabase, sessionId)
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to read walk',
        },
        { status: 500 },
      )
    }
    const key = (p: IncomingPoint) =>
      `${Date.parse(p.recordedAt)}:${p.lat}:${p.lng}`
    const existing = saved.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracyM: p.accuracy_m,
      recordedAt: p.recorded_at,
    }))
    const seen = new Set(existing.map(key))
    const incoming = points.filter((p) => {
      const time = Date.parse(p.recordedAt)
      if (
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lat) > 90 ||
        Math.abs(p.lng) > 180 ||
        !Number.isFinite(time) ||
        time > Date.now() + 60_000 ||
        (p.accuracyM ?? 0) > 50 ||
        seen.has(key(p))
      )
        return false
      seen.add(key(p))
      return true
    })
    const newPoints = new Set(incoming)
    const ordered = [...existing, ...incoming].sort(
      (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
    )
    let last: IncomingPoint | null = null
    let anchor: IncomingPoint | null = null
    accepted = []
    for (const point of ordered) {
      const next = { ...point, accuracyM: point.accuracyM ?? null }
      // Reconstruct the baseline in time order, including delayed/offline
      // walking samples. Only new samples can trigger a new automatic stop.
      if (
        newPoints.has(point) &&
        last &&
        (exceedsWalkingLimits(
          { ...last, accuracyM: last.accuracyM ?? null },
          next,
        ) ||
          (anchor &&
            exceedsWalkingLimits(
              { ...anchor, accuracyM: anchor.accuracyM ?? null },
              next,
            )))
      ) {
        stopAt = last.recordedAt
        break
      }
      if (newPoints.has(point)) accepted.push(point)
      last = point
      if (
        !anchor ||
        Date.parse(point.recordedAt) - Date.parse(anchor.recordedAt) >= 60_000
      )
        anchor = point
    }
  }

  const rows = accepted
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

  if (rows.length > 0) {
    const { error } = await supabase.from('canvass_points').insert(rows)
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (stopAt || session.status !== 'active') {
    try {
      const totals = await canvassTotals(supabase, sessionId)
      const update = supabase
        .from('canvass_sessions')
        .update({
          ...totals,
          ...(stopAt
            ? {
                status: 'completed',
                ended_at: stopAt,
                notes: CANVASS_AUTO_STOP_NOTE,
              }
            : {}),
        })
        .eq('id', sessionId)
        .eq('user_id', access.id)
      const { error } = await update
      if (error) throw new Error(error.message)
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : 'Failed to save walk',
        },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    autoStopped: !!stopAt,
  })
}
