import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
import { createAdminClient } from '@/supabase/server'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createAdminClient()
  const { data, error } = await db
    .from('fleet_trackers')
    .select(
      'id,name,enabled,firmware,battery_v,gps_fix,last_seen_at,gps_at,latitude,longitude,speed_mps,bearing,satellites',
    )
    .order('name')
  if (error)
    return NextResponse.json(
      { error: 'Unable to load trackers' },
      { status: 503 },
    )
  let hangingDoors: boolean | null = null
  if (request.nextUrl.searchParams.get('activity') === '1') {
    const session = await db
      .from('canvass_sessions')
      .select('id,started_at')
      .eq('user_id', DAVID_CANVASS_USER_ID)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!session.error && !session.data) hangingDoors = false
    if (session.data) {
      const point = await db
        .from('canvass_points')
        .select('recorded_at')
        .eq('session_id', session.data.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!point.error) {
        const lastActivity = point.data?.recorded_at ?? session.data.started_at
        hangingDoors = Date.now() - Date.parse(lastActivity) < 5 * 60_000
      }
    }
  }
  return NextResponse.json(
    { trackers: data, ...(hangingDoors == null ? {} : { hangingDoors }) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
