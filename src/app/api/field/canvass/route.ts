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
    // A phone that died mid-walk leaves an active session behind — close it
    // as completed rather than blocking a new start.
    await supabase
      .from('canvass_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('user_id', access.id)
      .eq('status', 'active')

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
