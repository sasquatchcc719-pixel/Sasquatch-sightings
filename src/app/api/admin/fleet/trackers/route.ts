import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await createAdminClient()
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
  return NextResponse.json(
    { trackers: data },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
