/**
 * Geo-grid rank scanning — the "Local Falcon style" coverage map.
 *
 * A single daily rank per town is close to useless: re-running the same Palmer
 * Lake query three times inside one minute returned #1, #4, #1. Worse, one
 * reading cannot tell you WHERE in a town you rank — and in the Monument pack,
 * position is dominated by distance from the searcher (Spearman rank/distance
 * +0.537; reviews, controlling for distance, p = 0.41).
 *
 * Pure geometry lives in `radar-grid-geo.ts` so the admin UI can price a scan
 * without importing anything server-only. This file is the runner.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
// DataForSEO, not SerpApi — ~42x cheaper per grid point ($0.0006-0.002 vs
// $0.025), which is what makes a dense weekly service-area scan affordable.
import { fetchMapsAtPoint } from '@/lib/dataforseo'
import {
  buildAreaGrid,
  buildGrid,
  computeStats,
  findMyRank,
  polygonBbox,
  DEFAULT_GRID,
  SERVICE_AREA_POLYGON,
  SERVICE_AREA_DEFAULT_SPACING_MILES,
  type GridPreset,
} from '@/lib/radar-grid-geo'

// Re-exported so existing importers of this module keep working.
export * from '@/lib/radar-grid-geo'

export type GridScanResult = {
  scanId: string | null
  pointsScanned: number
  pointsRanked: number
  avgRank: number | null
  visibilityPct: number
  error?: string
}

export type GridScanOptions = {
  preset?: GridPreset
  keyword?: string
  /** Overrides the preset default. Cost is one DataForSEO Maps call per point (~$0.002). */
  spacingMiles?: number
}

export async function runGridScan(
  supabase: SupabaseClient,
  options?: GridScanOptions,
): Promise<GridScanResult> {
  const preset: GridPreset = options?.preset ?? 'tri-lakes'
  const keyword = options?.keyword ?? DEFAULT_GRID.keyword
  const isArea = preset === 'service-area'

  const spacingMiles =
    options?.spacingMiles ??
    (isArea ? SERVICE_AREA_DEFAULT_SPACING_MILES : DEFAULT_GRID.spacingMiles)

  const points = isArea
    ? buildAreaGrid(SERVICE_AREA_POLYGON, spacingMiles)
    : buildGrid(
        DEFAULT_GRID.centerLat,
        DEFAULT_GRID.centerLng,
        DEFAULT_GRID.size,
        spacingMiles,
      )

  const bb = isArea ? polygonBbox(SERVICE_AREA_POLYGON) : null
  const centerLat = bb ? (bb.minLat + bb.maxLat) / 2 : DEFAULT_GRID.centerLat
  const centerLng = bb ? (bb.minLng + bb.maxLng) / 2 : DEFAULT_GRID.centerLng

  const { data: scan, error: scanError } = await supabase
    .from('radar_grid_scans')
    .insert({
      keyword,
      label: isArea
        ? 'Service area — Castle Rock to Colorado Springs'
        : DEFAULT_GRID.label,
      preset,
      center_lat: centerLat,
      center_lng: centerLng,
      // Square grids have an edge length; polygon-clipped ones don't.
      grid_size: isArea ? null : DEFAULT_GRID.size,
      bbox: bb,
      spacing_miles: spacingMiles,
      points_total: points.length,
    })
    .select('id')
    .single()

  if (scanError || !scan) {
    return {
      scanId: null,
      pointsScanned: 0,
      pointsRanked: 0,
      avgRank: null,
      visibilityPct: 0,
      error: `Could not create scan row: ${scanError?.message ?? 'unknown'}`,
    }
  }

  // Hoisted out of the closure below: the null check above narrows `scan` here
  // but not inside `worker`, which TS treats as possibly-deferred.
  const scanId: string = scan.id

  const ranks: (number | null)[] = []
  let firstError: string | undefined
  let scanned = 0

  // Concurrency pool instead of the old sequential loop. The sequential form
  // (with a 2s politeness sleep) was a SerpApi relic; at DataForSEO's ~14s
  // per live call it made a 141-point scan take ~35 minutes — longer than any
  // serverless function survives, so the weekly cron would silently die
  // mid-scan. Eight workers bring the same scan to ~4 minutes, well inside
  // the route's maxDuration, and stay far under DataForSEO's 2,000 req/min
  // rate limit.
  const CONCURRENCY = 8
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < points.length) {
      const pt = points[cursor++]
      try {
        const places = await fetchMapsAtPoint(keyword, pt.lat, pt.lng)
        const myRank = findMyRank(places)
        ranks.push(myRank)
        scanned++

        await supabase.from('radar_grid_points').insert({
          scan_id: scanId,
          row_idx: pt.row,
          col_idx: pt.col,
          lat: pt.lat,
          lng: pt.lng,
          my_rank: myRank,
          top_places: places.slice(0, 3).map((p) => ({
            position: p.position,
            title: p.title,
            reviews: p.reviews,
            place_id: p.place_id,
          })),
        })
      } catch (err) {
        // DataForSEO is pay-as-you-go, not monthly-capped like SerpApi was,
        // so there is no quota-exhausted case to special-case — any failure
        // is a per-point error, logged and skipped.
        const msg = err instanceof Error ? err.message : String(err)
        if (!firstError) firstError = msg
        console.error(`[Radar Grid] point ${pt.row},${pt.col} failed:`, msg)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, points.length) }, worker),
  )

  const stats = computeStats(ranks)

  await supabase
    .from('radar_grid_scans')
    .update({
      points_scanned: scanned,
      points_ranked: stats.ranked,
      avg_rank: stats.avgRank,
      visibility_pct: stats.visibilityPct,
      status: scanned === points.length ? 'completed' : 'partial',
      error: firstError ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', scan.id)

  return {
    scanId: scan.id,
    pointsScanned: scanned,
    pointsRanked: stats.ranked,
    avgRank: stats.avgRank,
    visibilityPct: stats.visibilityPct,
    ...(firstError ? { error: firstError } : {}),
  }
}
