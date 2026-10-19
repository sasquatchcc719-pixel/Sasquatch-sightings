/**
 * Shared canvassing coverage map data.
 * GET    ?days=0 — all-time completed and active walks, colored by age.
 *                  Both Charles and David see everyone's saved coverage.
 * DELETE ?sessionId= — admin/owner only: remove an accidental/bad session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { haversineDistance } from '@/lib/gps/haversine'

const PAGE_SIZE = 1000

type CoverageSession = {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  status: string
  point_count: number
  distance_m: number | null
}

function coverageColor(iso: string, now: Date): string {
  // Clamp month ends (e.g. August 31 minus six months is February 28).
  const monthsAgo = (months: number) => {
    const cutoff = new Date(now)
    cutoff.setUTCDate(1)
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
    const lastDay = new Date(
      Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
    ).getUTCDate()
    cutoff.setUTCDate(Math.min(now.getUTCDate(), lastDay))
    return cutoff.getTime()
  }
  const date = Date.parse(iso)
  if (date <= monthsAgo(12)) return '#ef4444'
  if (date <= monthsAgo(6)) return '#3b82f6'
  return '#22c55e'
}

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
  const now = new Date()
  const sessions: CoverageSession[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from('canvass_sessions')
      .select(
        'id, user_id, started_at, ended_at, status, point_count, distance_m',
      )
      .in('status', ['completed', 'active'])
      .order('started_at', { ascending: false })
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (days > 0) {
      query = query.gte(
        'started_at',
        new Date(now.getTime() - days * 86400000).toISOString(),
      )
    }
    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    sessions.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  if (!sessions?.length) {
    return NextResponse.json({
      geojson: { type: 'FeatureCollection', features: [] },
      sessions: [],
    })
  }

  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('user_id, display_name')
  if (staffError) {
    return NextResponse.json({ error: staffError.message }, { status: 500 })
  }
  const nameByUser = new Map<string, string>()
  ;(staff ?? []).forEach((s) => {
    if (!s.user_id) return
    nameByUser.set(s.user_id, s.display_name)
  })

  const pointsBySession = new Map<string, TrackPoint[]>()
  // Batch session IDs to keep URLs bounded, then page through every point.
  // An unpaginated query silently stops at the database's 1,000-row cap.
  for (let start = 0; start < sessions.length; start += 100) {
    const ids = sessions.slice(start, start + 100).map((s) => s.id)
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data: points, error: pointsError } = await supabase
        .from('canvass_points')
        .select('session_id, lat, lng, recorded_at')
        .in('session_id', ids)
        .order('recorded_at', { ascending: true })
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1)
      if (pointsError) {
        return NextResponse.json(
          { error: pointsError.message },
          { status: 500 },
        )
      }
      for (const p of points ?? []) {
        const list = pointsBySession.get(p.session_id) ?? []
        list.push({ lng: p.lng, lat: p.lat, t: Date.parse(p.recorded_at) })
        pointsBySession.set(p.session_id, list)
      }
      if (!points || points.length < PAGE_SIZE) break
    }
  }

  const rows = sessions.map((s) => {
    const points = pointsBySession.get(s.id) ?? []
    let distance = s.distance_m
    if (s.status === 'active') {
      distance = 0
      for (let i = 1; i < points.length; i++) {
        distance += haversineDistance(
          points[i - 1].lat,
          points[i - 1].lng,
          points[i].lat,
          points[i].lng,
        )
      }
      distance = Math.round(distance)
    }
    return {
      ...s,
      user_name: nameByUser.get(s.user_id) ?? 'Unknown',
      color: coverageColor(s.ended_at ?? s.started_at, now),
      point_count: points.length,
      distance_m: distance,
    }
  })

  // Draw oldest first so fresh green coverage wins where routes overlap.
  const features = rows
    .slice()
    .reverse()
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
          color: s.color,
          dateLabel,
          label: `${dateLabel} — ${userName}`,
          distanceM: s.distance_m,
        },
      }
    })
    .filter(Boolean)
  const mappedIds = new Set(features.map((f) => f?.properties.sessionId))

  return NextResponse.json({
    geojson: { type: 'FeatureCollection', features },
    sessions: rows.map((s) => ({
      ...s,
      has_route: mappedIds.has(s.id),
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
