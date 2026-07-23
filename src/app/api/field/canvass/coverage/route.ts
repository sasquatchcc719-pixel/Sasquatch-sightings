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

// Stable per-user colors: owner/admin = blue, techs = green, extras cycle.
const USER_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6']

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

  const pointsBySession = new Map<string, [number, number][]>()
  for (const p of points ?? []) {
    const list = pointsBySession.get(p.session_id) ?? []
    list.push([p.lng, p.lat])
    pointsBySession.set(p.session_id, list)
  }

  const features = sessions
    .map((s) => {
      const coords = pointsBySession.get(s.id) ?? []
      if (coords.length < 2) return null
      const dateLabel = new Date(s.started_at).toLocaleDateString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
      const userName = nameByUser.get(s.user_id) ?? 'Unknown'
      return {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
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
