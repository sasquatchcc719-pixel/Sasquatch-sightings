/**
 * Geo-grid scan data for the admin Radar page.
 *
 * GET  — list recent scans, or one scan's points via ?scanId=
 * POST — run a scan now (one DataForSEO Maps call per grid point)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  runGridScan,
  DEFAULT_GRID,
  estimateGridCost,
  MAX_SERVICE_AREA_POINTS,
  type GridPreset,
} from '@/lib/radar-grid'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()
    const scanId = request.nextUrl.searchParams.get('scanId')

    const { data: scans, error: scansError } = await supabase
      .from('radar_grid_scans')
      .select(
        'id, keyword, label, preset, bbox, center_lat, center_lng, grid_size, spacing_miles, points_total, points_scanned, points_ranked, avg_rank, visibility_pct, status, error, created_at, completed_at',
      )
      .order('created_at', { ascending: false })
      .limit(24)
    if (scansError) throw scansError

    const targetId = scanId || scans?.[0]?.id
    if (!targetId) return NextResponse.json({ ok: true, scans: [], scan: null, points: [] })

    const { data: points, error: pointsError } = await supabase
      .from('radar_grid_points')
      .select('row_idx, col_idx, lat, lng, my_rank, top_places')
      .eq('scan_id', targetId)
      .order('row_idx')
      .order('col_idx')
    if (pointsError) throw pointsError

    let scan = (scans ?? []).find((s) => s.id === targetId) ?? null
    // Mid-run rows used to sit at 0/0 until the end — prefer live point counts.
    if (scan && (scan.status === 'running' || scan.points_scanned === 0) && points?.length) {
      const ranked = points.filter((p) => p.my_rank != null).length
      scan = {
        ...scan,
        points_scanned: Math.max(scan.points_scanned ?? 0, points.length),
        points_ranked: Math.max(scan.points_ranked ?? 0, ranked),
      }
    }

    return NextResponse.json({
      ok: true,
      scans: scans ?? [],
      scan,
      points: points ?? [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load grid'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[admin/radar/grid GET]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])

    const body = (await request.json().catch(() => ({}))) as {
      preset?: string
      spacingMiles?: number
      keyword?: string
      bufferMiles?: number
      centerLat?: number
      centerLng?: number
      gridSize?: number
    }
    const preset: GridPreset =
      body.preset === 'service-area' ? 'service-area' : 'tri-lakes'
    const spacingMiles =
      typeof body.spacingMiles === 'number' && body.spacingMiles > 0
        ? Math.min(Math.max(body.spacingMiles, 1), 10)
        : undefined
    const keyword =
      typeof body.keyword === 'string' && body.keyword.trim().length > 0
        ? body.keyword.trim().slice(0, 120)
        : undefined
    const bufferMiles =
      typeof body.bufferMiles === 'number' && body.bufferMiles >= 0
        ? Math.min(Math.max(body.bufferMiles, 0), 15)
        : undefined
    const centerLat =
      typeof body.centerLat === 'number' && Number.isFinite(body.centerLat)
        ? Math.min(Math.max(body.centerLat, 37), 41)
        : undefined
    const centerLng =
      typeof body.centerLng === 'number' && Number.isFinite(body.centerLng)
        ? Math.min(Math.max(body.centerLng, -106), -103)
        : undefined
    const gridSize =
      typeof body.gridSize === 'number' && body.gridSize >= 3
        ? Math.min(Math.max(Math.round(body.gridSize), 3), 21)
        : undefined

    if (preset === 'service-area') {
      const estimate = estimateGridCost('service-area', spacingMiles, {
        bufferMiles: bufferMiles ?? 0,
      })
      if (estimate > MAX_SERVICE_AREA_POINTS) {
        return NextResponse.json(
          {
            error: `That service-area run is ${estimate} points (max ${MAX_SERVICE_AREA_POINTS}). Bump spacing to 2 mi+ or lower the edge buffer — 1 mi grids time out and leave a broken half-map.`,
            points: estimate,
            max: MAX_SERVICE_AREA_POINTS,
          },
          { status: 400 },
        )
      }
    }

    const supabase = createAdminClient()
    const result = await runGridScan(supabase, {
      preset,
      spacingMiles,
      keyword,
      bufferMiles,
      centerLat,
      centerLng,
      gridSize,
    })
    if (result.error && !result.scanId) {
      return NextResponse.json({ error: result.error, ...result }, { status: 400 })
    }
    return NextResponse.json({ ok: true, ...result, preset, config: DEFAULT_GRID })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Grid scan failed'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[admin/radar/grid POST]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
