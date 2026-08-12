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
  fetchAiSurfaceAtPoint,
  type AiSurfacePlace,
} from '@/lib/dataforseo-data'
import type { SerpMapPackPlace } from '@/lib/serpApi'
import {
  buildAreaGrid,
  buildGrid,
  computeStats,
  findMyRank,
  polygonBbox,
  DEFAULT_GRID,
  SERVICE_AREA_POLYGON,
  SERVICE_AREA_DEFAULT_SPACING_MILES,
  MAX_SERVICE_AREA_POINTS,
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
  /** Miles outside the service-area polygon (service-area preset only). */
  bufferMiles?: number
  /** Square-grid center (tri-lakes / custom). Defaults to Monument. */
  centerLat?: number
  centerLng?: number
  /** Odd N for N×N square grids. Defaults to 5. */
  gridSize?: number
  /**
   * Which Google surface to scan. These are genuinely different results, not
   * views of one ranking — verified 2026-08-11 at 38.8076,-104.7442, where the
   * local pack, organic and AI Overview all placed us nowhere while AI Mode
   * named five competitors.
   *
   * Note on cost: AI surfaces are $0.004/point vs ~$0.002 for Maps. A 141-point
   * service-area AI Mode grid is about $0.56.
   */
  platform?: GridPlatform
}

export type GridPlatform = 'google_maps' | 'ai_mode' | 'ai_overview' | 'ai_summary'

export const GRID_PLATFORMS: GridPlatform[] = [
  'google_maps',
  'ai_mode',
  'ai_overview',
  'ai_summary',
]

export const GRID_PLATFORM_LABELS: Record<GridPlatform, string> = {
  google_maps: 'Google Maps (local pack)',
  ai_mode: 'Google AI Mode',
  ai_overview: 'Google AI Overview',
  ai_summary: 'Google AI Summary',
}

/**
 * Adapt an AI answer to the map-pack shape so the rest of the grid pipeline —
 * findMyRank, ARP, the heat map, radar_grid_points — works unchanged.
 *
 * `position` is order of mention, not a ranking: AI answers have no rank field.
 * Treating it as one is the least-wrong option and keeps a single storage
 * format, but don't read "position 4" as equivalent to map-pack rank 4.
 * Rating/reviews/place_id are genuinely absent, not merely unparsed.
 */
function aiToMapPackShape(items: AiSurfacePlace[]): SerpMapPackPlace[] {
  return items.map((i) => ({
    position: i.position,
    title: i.domain,
    domain: i.domain,
    rating: null,
    reviews: null,
    address: null,
    place_id: null,
    lat: null,
    lng: null,
  }))
}

export async function runGridScan(
  supabase: SupabaseClient,
  options?: GridScanOptions,
): Promise<GridScanResult> {
  const preset: GridPreset = options?.preset ?? 'tri-lakes'
  const keyword = options?.keyword ?? DEFAULT_GRID.keyword
  const platform: GridPlatform = options?.platform ?? 'google_maps'
  const isArea = preset === 'service-area'

  const spacingMiles =
    options?.spacingMiles ??
    (isArea ? SERVICE_AREA_DEFAULT_SPACING_MILES : DEFAULT_GRID.spacingMiles)
  const bufferMiles = Math.max(0, options?.bufferMiles ?? 0)
  const gridSize = Math.min(
    21,
    Math.max(3, Math.round(options?.gridSize ?? DEFAULT_GRID.size) || DEFAULT_GRID.size),
  )
  // Force odd size so the center pin sits on a lattice point.
  const size = gridSize % 2 === 0 ? gridSize + 1 : gridSize
  const squareCenterLat = options?.centerLat ?? DEFAULT_GRID.centerLat
  const squareCenterLng = options?.centerLng ?? DEFAULT_GRID.centerLng

  const points = isArea
    ? buildAreaGrid(SERVICE_AREA_POLYGON, spacingMiles, bufferMiles)
    : buildGrid(squareCenterLat, squareCenterLng, size, spacingMiles)

  if (isArea && points.length > MAX_SERVICE_AREA_POINTS) {
    return {
      scanId: null,
      pointsScanned: 0,
      pointsRanked: 0,
      avgRank: null,
      visibilityPct: 0,
      error: `Service-area scan is ${points.length} points (max ${MAX_SERVICE_AREA_POINTS}). Increase spacing or lower the edge buffer — 1 mi + buffer will time out mid-run.`,
    }
  }

  const bb = isArea ? polygonBbox(SERVICE_AREA_POLYGON) : null
  const centerLat = isArea
    ? bb
      ? (bb.minLat + bb.maxLat) / 2
      : DEFAULT_GRID.centerLat
    : squareCenterLat
  const centerLng = isArea
    ? bb
      ? (bb.minLng + bb.maxLng) / 2
      : DEFAULT_GRID.centerLng
    : squareCenterLng

  const areaLabel =
    bufferMiles > 0
      ? `Service area + ${bufferMiles} mi edge — Castle Rock to Colorado Springs`
      : 'Service area — Castle Rock to Colorado Springs'
  const squareLabel =
    Math.abs(squareCenterLat - DEFAULT_GRID.centerLat) < 0.0001 &&
    Math.abs(squareCenterLng - DEFAULT_GRID.centerLng) < 0.0001
      ? DEFAULT_GRID.label
      : `Custom ${size}×${size} @ ${squareCenterLat.toFixed(3)}, ${squareCenterLng.toFixed(3)}`

  const { data: scan, error: scanError } = await supabase
    .from('radar_grid_scans')
    .insert({
      keyword,
      label: isArea ? areaLabel : squareLabel,
      preset,
      platform,
      center_lat: centerLat,
      center_lng: centerLng,
      // Square grids have an edge length; polygon-clipped ones don't.
      grid_size: isArea ? null : size,
      bbox: bb,
      spacing_miles: spacingMiles,
      points_total: points.length,
      points_scanned: 0,
      points_ranked: 0,
      status: 'running',
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
  let ranked = 0
  let lastProgressWrite = 0

  // Concurrency pool instead of the old sequential loop. The sequential form
  // (with a 2s politeness sleep) was a SerpApi relic; at DataForSEO's ~14s
  // per live call it made a 141-point scan take ~35 minutes — longer than any
  // serverless function survives, so the weekly cron would silently die
  // mid-scan. Eight workers bring the same scan to ~4 minutes, well inside
  // the route's maxDuration, and stay far under DataForSEO's 2,000 req/min
  // rate limit.
  const CONCURRENCY = 8
  let cursor = 0

  async function flushProgress(force = false): Promise<void> {
    if (!force && scanned - lastProgressWrite < 8) return
    lastProgressWrite = scanned
    await supabase
      .from('radar_grid_scans')
      .update({
        points_scanned: scanned,
        points_ranked: ranked,
        status: 'running',
      })
      .eq('id', scanId)
  }

  async function worker(): Promise<void> {
    while (cursor < points.length) {
      const pt = points[cursor++]
      try {
        const places =
          platform === 'google_maps'
            ? await fetchMapsAtPoint(keyword, pt.lat, pt.lng)
            : aiToMapPackShape(
                await fetchAiSurfaceAtPoint(keyword, pt.lat, pt.lng, platform),
              )
        const myRank = findMyRank(places)
        ranks.push(myRank)
        scanned++
        if (myRank != null) ranked++

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
        await flushProgress()
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
