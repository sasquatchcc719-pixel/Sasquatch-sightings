/**
 * Local Falcon scans stored in our own database.
 *
 * GET                 -> list of scans (newest first) + points for the newest
 * GET ?scanId=<uuid>  -> same list, points for that scan
 * POST                -> pull any new scans from Local Falcon (no credits spent)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { syncLocalFalconScans } from '@/lib/ops/local-falcon-sync'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const { data: scans, error } = await supabase
      .from('local_falcon_scans')
      .select(
        'id, report_key, keyword, platform, scanned_at, grid_size, radius, measurement, center_lat, center_lng, arp, atrp, solv, found_in, points_total, unique_competitors, public_url',
      )
      .order('scanned_at', { ascending: false })
      .limit(50)
    if (error) throw error

    const requested = request.nextUrl.searchParams.get('scanId')
    const active = requested
      ? (scans ?? []).find((s) => s.id === requested)
      : (scans ?? [])[0]

    let points: unknown[] = []
    if (active) {
      const { data, error: pErr } = await supabase
        .from('local_falcon_points')
        .select('idx, lat, lng, found, rank, competitors')
        .eq('scan_id', active.id)
        .order('idx')
      if (pErr) throw pErr
      points = data ?? []
    }

    return NextResponse.json({
      ok: true,
      scans: scans ?? [],
      scan: active ?? null,
      points,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load scans'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[local-falcon GET]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST() {
  try {
    await requireAnyRole(['admin', 'owner'])
    if (!process.env.LOCAL_FALCON_API_KEY) {
      return NextResponse.json(
        { error: 'LOCAL_FALCON_API_KEY is not configured' },
        { status: 400 },
      )
    }
    const result = await syncLocalFalconScans(createAdminClient(), { limit: 50 })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[local-falcon POST]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
