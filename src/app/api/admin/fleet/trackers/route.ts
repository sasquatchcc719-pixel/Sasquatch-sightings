import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { readDavidCanvassStatus } from '@/lib/gps/david-canvass-status'
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
  const hangingDoors =
    request.nextUrl.searchParams.get('activity') === '1'
      ? await readDavidCanvassStatus(db)
      : null
  return NextResponse.json(
    { trackers: data, ...(hangingDoors == null ? {} : { hangingDoors }) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
