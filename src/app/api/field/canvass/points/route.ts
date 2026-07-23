/**
 * Canvassing GPS breadcrumb ingestion. Batched by the client (~30s cadence).
 * Points only land on a session the caller owns and that is still active.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

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

  const { data: session } = await supabase
    .from('canvass_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', access.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!session) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 403 })
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

  // point_count and distance are finalized at stop time from the real rows.
  return NextResponse.json({ ok: true, inserted: rows.length })
}
