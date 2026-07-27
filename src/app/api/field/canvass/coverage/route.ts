/**
 * Shared canvassing coverage map data.
 * GET    ?days=30 — completed sessions (all users) as GeoJSON LineStrings with
 *                   per-user color, display name, and a date label, plus a
 *                   session list for the admin panel. Both Charles and David
 *                   see everyone's coverage — that's the point.
 * DELETE ?sessionId= — admin/owner only: remove an accidental/bad session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { haversineDistance } from '@/lib/gps/haversine'

// Stable per-user colors: owner/admin = blue, techs = green, extras cycle.
const USER_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6']

/**
 * Phones suspend GPS when the screen locks, so a walked street often arrives
 * as a handful of points with minutes-long holes. Bridging consecutive points
 * fills those holes back in — but only when the movement between them could
 * plausibly have been walked. Anything faster than a brisk walk, or too far
 * to infer a path through, is a drive between neighborhoods and gets split
 * into a separate segment so it is never shaded as covered ground.
 */
const MAX_WALK_SPEED_MPS = 3.0 // ~6.7 mph
const MAX_BRIDGE_M = 800
/**
 * Below this, never split. GPS jitter while standing at a door routinely
 * throws a 10-20m hop in one second, which reads as 10+ m/s and would shred
 * a perfectly good walk into fragments. A real drive always covers far more
 * ground than this, so distance is the honest gate and speed only decides
 * among genuinely long gaps.
 */
const MIN_SPLIT_DISTANCE_M = 150

type TrackPoint = { lng: number; lat: number; t: number }

function buildSegments(points: TrackPoint[]): [number, number][][] {
  const segments: [number, number][][] = []
  let current: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i === 0) {
      current = [[p.lng, p.lat]]
      continue
    }
    const prev = points[i - 1]
    const meters = haversineDistance(prev.lat, prev.lng, p.lat, p.lng)
    const seconds = Math.max((p.t - prev.t) / 1000, 1)
    const tooFarToInfer = meters > MAX_BRIDGE_M
    const drove =
      meters > MIN_SPLIT_DISTANCE_M && meters / seconds > MAX_WALK_SPEED_MPS
    if (tooFarToInfer || drove) {
      if (current.length > 1) segments.push(current)
      current = [[p.lng, p.lat]]
      continue
    }
    current.push([p.lng, p.lat])
  }
  if (current.length > 1) segments.push(current)
  return segments
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const days = Number(request.nextUrl.searchParams.get('days') ?? '0')
  let query = supabase
    .from('canvass_sessions')
    .select('id, user_id, started_at, ended_at, point_count, distance_m')
    .eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(500)
  if (days > 0) {
    query = query.gte(
      'started_at',
      new Date(Date.now() - days * 86400000).toISOString(),
    )
  }
  const { data: sessions, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!sessions?.length) {
    return NextResponse.json({
      geojson: { type: 'FeatureCollection', features: [] },
      sessions: [],
    })
  }

  // Display names + stable color assignment (staff_users order = stable).
  const { data: staff } = await supabase
    .from('staff_users')
    .select('user_id, display_name, role')
    .order('created_at', { ascending: true })
  const nameByUser = new Map<string, string>()
  const colorByUser = new Map<string, string>()
  ;(staff ?? []).forEach((s, i) => {
    if (!s.user_id) return
    nameByUser.set(s.user_id, s.display_name)
    colorByUser.set(
      s.user_id,
      s.role === 'owner' || s.role === 'dispatcher'
        ? USER_COLORS[0]
        : USER_COLORS[(i % (USER_COLORS.length - 1)) + 1],
    )
  })

  const { data: points } = await supabase
    .from('canvass_points')
    .select('session_id, lat, lng, recorded_at')
    .in(
      'session_id',
      sessions.map((s) => s.id),
    )
    .order('recorded_at', { ascending: true })

  const pointsBySession = new Map<string, TrackPoint[]>()
  for (const p of points ?? []) {
    const list = pointsBySession.get(p.session_id) ?? []
    list.push({ lng: p.lng, lat: p.lat, t: Date.parse(p.recorded_at) })
    pointsBySession.set(p.session_id, list)
  }

  const features = sessions
    .map((s) => {
      const segments = buildSegments(pointsBySession.get(s.id) ?? [])
      if (segments.length === 0) return null
      const dateLabel = new Date(s.started_at).toLocaleDateString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      const userName = nameByUser.get(s.user_id) ?? 'Unknown'
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiLineString' as const,
          coordinates: segments,
        },
        properties: {
          sessionId: s.id,
          userName,
          color: colorByUser.get(s.user_id) ?? USER_COLORS[4],
          dateLabel,
          label: `${dateLabel} — ${userName}`,
          distanceM: s.distance_m,
        },
      }
    })
    .filter(Boolean)

  return NextResponse.json({
    geojson: { type: 'FeatureCollection', features },
    sessions: sessions.map((s) => ({
      ...s,
      user_name: nameByUser.get(s.user_id) ?? 'Unknown',
      color: colorByUser.get(s.user_id) ?? USER_COLORS[4],
    })),
  })
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('canvass_sessions')
    .delete()
    .eq('id', sessionId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
