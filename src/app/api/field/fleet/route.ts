/**
 * Start-of-day fleet check-in (tech-accessible).
 * GET  - active assets with current meters
 * POST - { assetId, reading } log today's odometer/engine-hours and update
 *        the asset's current meter. The 10-second morning flow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'tech'])
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('fleet_assets')
    .select('id, name, asset_type, meter_type, current_meter')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ assets: data ?? [] })
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
  const assetId = String(body.assetId ?? '')
  const reading = Number(body.reading)
  if (!assetId || !Number.isFinite(reading) || reading < 0) {
    return NextResponse.json(
      { error: 'assetId and a valid reading are required' },
      { status: 400 },
    )
  }

  const { data: asset } = await supabase
    .from('fleet_assets')
    .select('id, current_meter, meter_type')
    .eq('id', assetId)
    .maybeSingle()
  if (!asset) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
  }
  if (asset.meter_type === 'none') {
    return NextResponse.json(
      { error: 'This asset has no meter to log' },
      { status: 400 },
    )
  }
  // Meters only go up — catch fat-finger entries below the last reading.
  if (asset.current_meter != null && reading < Number(asset.current_meter)) {
    return NextResponse.json(
      {
        error: `Reading ${reading} is below the last recorded ${asset.current_meter}. Double-check the number.`,
      },
      { status: 400 },
    )
  }

  const { error: logError } = await supabase.from('asset_meter_logs').insert({
    asset_id: assetId,
    user_id: access.id,
    reading,
  })
  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 })
  }
  await supabase
    .from('fleet_assets')
    .update({ current_meter: reading })
    .eq('id', assetId)

  return NextResponse.json({ ok: true })
}
