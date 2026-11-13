import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { readDavidCanvassStatus } from '@/lib/gps/david-canvass-status'
import { readBoxTruckTravelProgress } from '@/lib/ops/box-truck-travel'
import { BOX_TRUCK_NAME } from '@/lib/truck-temperature'
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
  const includeActivity = request.nextUrl.searchParams.get('activity') === '1'
  const tracker = data?.find((item) => item.name === BOX_TRUCK_NAME)
  const [hangingDoors, travelProgress] = includeActivity
    ? await Promise.all([
        readDavidCanvassStatus(db),
        tracker ? readBoxTruckTravelProgress(db, tracker) : null,
      ])
    : [null, null]
  return NextResponse.json(
    {
      trackers: data,
      ...(hangingDoors == null ? {} : { hangingDoors }),
      ...(travelProgress ? { travelProgress } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
