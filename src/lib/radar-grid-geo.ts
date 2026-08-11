/**
 * Pure geometry and scoring for the geo-grid scan.
 *
 * Deliberately free of server-only imports so the admin UI can price a scan
 * before running it. `radar-grid.ts` holds everything that touches SerpApi or
 * Supabase; importing that from a client component drags in `next/headers` and
 * breaks the build.
 */

import type { SerpMapPackPlace } from '@/lib/serpApi'

/** Our business, as it appears in Google Maps. Matched by name, then domain. */
export const MY_BUSINESS_NAME = 'sasquatch carpet cleaning'
export const MY_DOMAIN = 'sasquatchcarpet.com'

/**
 * Tight grid centred on Monument, the contested town. 5x5 at 1.5 miles covers
 * Palmer Lake down to Gleneagle — the corridor we actually compete in.
 */
export const DEFAULT_GRID = {
  keyword: 'carpet cleaning',
  label: 'Tri-Lakes corridor',
  centerLat: 39.0908,
  centerLng: -104.8698,
  size: 5,
  spacingMiles: 1.5,
}

/**
 * The real service area: Castle Rock down to mid Colorado Springs, ~42 miles
 * north-south by ~21 east-west. Same polygon the marketing site draws on its
 * coverage map, so the scan and the public map can never disagree.
 *
 * A plain rectangle over this wastes ~45% of its calls on ground we don't
 * serve, so the lattice gets clipped to the polygon.
 */
export const SERVICE_AREA_POLYGON: Array<[number, number]> = [
  [39.42, -104.92],
  [39.3722, -104.95],
  [39.28, -104.96],
  [39.18, -104.98],
  [39.1152, -104.96],
  [39.05, -104.92],
  [38.98, -104.9],
  [38.9, -104.92],
  [38.82, -104.88],
  [38.81, -104.8],
  [38.82, -104.7],
  [38.85, -104.6],
  [38.92, -104.58],
  [38.98, -104.58],
  [39.05, -104.62],
  [39.12, -104.65],
  [39.2, -104.72],
  [39.32, -104.78],
  [39.42, -104.82],
]

export type GridPreset = 'tri-lakes' | 'service-area'

/**
 * Spacing drives cost directly — one DataForSEO Maps call per point (~$0.002).
 * At 2 mi the service area is ~141 points; at 1.5 mi ~253; at 4 mi ~36.
 * Default matches the scheduled weekly scan so ad-hoc runs aren't coarser.
 */
export const SERVICE_AREA_DEFAULT_SPACING_MILES = 2

/**
 * Hard ceiling for an ad-hoc / cron service-area scan. At DataForSEO ~14s/point
 * with 8 workers, ~220 points ≈ 6–7 minutes — past that Vercel kills the run
 * mid-scan and you get a glitchy half-map (see 801-pt @ 1mi incident).
 */
export const MAX_SERVICE_AREA_POINTS = 220

/** Spacing choices shown in the admin UI (miles between lattice points). */
export const SERVICE_AREA_SPACING_OPTIONS_MILES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5] as const

/**
 * Search terms for ad-hoc + scheduled grid runs. Keep the list short — each
 * keyword is a separate experiment; mixing them in one chart lies.
 */
export const GRID_KEYWORD_PRESETS = [
  'carpet cleaning',
  'carpet cleaner',
  'carpet cleaning near me',
  'pet stain carpet cleaning',
  'upholstery cleaning',
] as const

/** Local Falcon odd sizes only — cost is grid_size² credits. */
export const LOCAL_FALCON_GRID_SIZES = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21] as const

/**
 * Extra miles outside the service-area polygon. 0 = clip tight (cheap).
 * 2–5 mi rings let you see where rank dies past the towns you serve.
 */
export const SERVICE_AREA_BUFFER_OPTIONS_MILES = [0, 2, 3, 5] as const

/** Square-grid sizes for movable-center Tri-Lakes / custom runs. */
export const SQUARE_GRID_SIZES = [3, 5, 7, 9] as const

export const MILES_PER_DEG_LAT = 69.0

/** Rough ground distance — fine at Colorado service-area scale. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const r = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Shortest distance from a point to any edge of the polygon (miles).
 * Inside points return 0.
 */
export function distanceToPolygonMiles(
  lat: number,
  lng: number,
  polygon: Array<[number, number]>,
): number {
  if (pointInPolygon(lat, lng, polygon)) return 0
  let best = Infinity
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lat1, lng1] = polygon[j]
    const [lat2, lng2] = polygon[i]
    // Project onto the segment in local miles space around mid-lat.
    const midLat = (lat1 + lat2) / 2
    const milesPerDegLng = MILES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180)
    const ax = lng1 * milesPerDegLng
    const ay = lat1 * MILES_PER_DEG_LAT
    const bx = lng2 * milesPerDegLng
    const by = lat2 * MILES_PER_DEG_LAT
    const px = lng * milesPerDegLng
    const py = lat * MILES_PER_DEG_LAT
    const abx = bx - ax
    const aby = by - ay
    const apx = px - ax
    const apy = py - ay
    const ab2 = abx * abx + aby * aby
    const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2))
    const cx = ax + t * abx
    const cy = ay + t * aby
    const d = Math.hypot(px - cx, py - cy)
    if (d < best) best = d
  }
  return best
}

export type GridPoint = { row: number; col: number; lat: number; lng: number }

export type Bbox = {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

/**
 * Build an N x N lattice centred on a coordinate.
 *
 * Longitude degrees shrink as you move away from the equator, so east-west
 * spacing is divided by cos(latitude) — without that the grid is visibly
 * squashed at Colorado's latitude and the "miles" spacing would be a lie.
 */
export function buildGrid(
  centerLat: number,
  centerLng: number,
  size: number,
  spacingMiles: number,
): GridPoint[] {
  const half = (size - 1) / 2
  const dLat = spacingMiles / MILES_PER_DEG_LAT
  const milesPerDegLng =
    MILES_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180)
  const dLng = spacingMiles / milesPerDegLng

  const points: GridPoint[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      points.push({
        row,
        col,
        // row 0 is the NORTH edge, so latitude decreases as row increases
        lat: centerLat + (half - row) * dLat,
        lng: centerLng + (col - half) * dLng,
      })
    }
  }
  return points
}

/**
 * Ray-casting point-in-polygon. Coordinates are treated as plain planar x/y,
 * which is accurate at this scale — the polygon spans ~40 miles, far too small
 * for curvature error to move a point across an edge.
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  polygon: Array<[number, number]>,
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i]
    const [latJ, lngJ] = polygon[j]
    const straddles = latI > lat !== latJ > lat
    if (
      straddles &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside
    }
  }
  return inside
}

export function polygonBbox(polygon: Array<[number, number]>): Bbox {
  const lats = polygon.map((p) => p[0])
  const lngs = polygon.map((p) => p[1])
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
}

/**
 * Lay a lattice over a polygon's bounding box (optionally padded) and keep
 * points inside the polygon, or within `bufferMiles` of its edge.
 *
 * Buffer > 0 is how you find the ranking cliff past the towns you serve —
 * without it every miss is still "inside" the service area and the edge is invisible.
 * Rows run north to south so row 0 is the top of the map.
 */
export function buildAreaGrid(
  polygon: Array<[number, number]>,
  spacingMiles: number,
  bufferMiles = 0,
): GridPoint[] {
  const core = polygonBbox(polygon)
  const midLat = (core.minLat + core.maxLat) / 2
  const padLat = Math.max(0, bufferMiles) / MILES_PER_DEG_LAT
  const padLng =
    Math.max(0, bufferMiles) /
    (MILES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180))
  const bb: Bbox = {
    minLat: core.minLat - padLat,
    maxLat: core.maxLat + padLat,
    minLng: core.minLng - padLng,
    maxLng: core.maxLng + padLng,
  }
  const dLat = spacingMiles / MILES_PER_DEG_LAT
  const dLng =
    spacingMiles / (MILES_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180))

  const rows = Math.floor((bb.maxLat - bb.minLat) / dLat) + 1
  const cols = Math.floor((bb.maxLng - bb.minLng) / dLng) + 1

  const points: GridPoint[] = []
  for (let row = 0; row < rows; row++) {
    const lat = bb.maxLat - row * dLat // north first
    for (let col = 0; col < cols; col++) {
      const lng = bb.minLng + col * dLng
      const inside = pointInPolygon(lat, lng, polygon)
      if (
        inside ||
        (bufferMiles > 0 && distanceToPolygonMiles(lat, lng, polygon) <= bufferMiles)
      ) {
        points.push({ row, col, lat, lng })
      }
    }
  }
  return points
}

export type EstimateGridCostOptions = {
  bufferMiles?: number
  centerLat?: number
  centerLng?: number
  size?: number
}

/** How many searches a scan will cost, without spending any. */
export function estimateGridCost(
  preset: GridPreset,
  spacingMiles?: number,
  options?: EstimateGridCostOptions,
): number {
  if (preset === 'service-area') {
    return buildAreaGrid(
      SERVICE_AREA_POLYGON,
      spacingMiles ?? SERVICE_AREA_DEFAULT_SPACING_MILES,
      options?.bufferMiles ?? 0,
    ).length
  }
  const size = options?.size ?? DEFAULT_GRID.size
  return size ** 2
}

/** Find our listing among a point's results. Name match first, domain as backup. */
export function findMyRank(places: SerpMapPackPlace[]): number | null {
  for (const p of places) {
    const title = (p.title ?? '').toLowerCase()
    if (title.includes(MY_BUSINESS_NAME)) return p.position
    if (p.domain && p.domain.replace(/^www\./, '') === MY_DOMAIN)
      return p.position
  }
  return null
}

/**
 * Average Rank Position over the points where we actually appeared.
 *
 * Deliberately excludes misses rather than substituting a sentinel: averaging
 * in a fake "21" would make ARP move when coverage changes even if every real
 * rank held steady. Coverage is reported separately.
 */
export function computeStats(ranks: (number | null)[]): {
  avgRank: number | null
  visibilityPct: number
  ranked: number
} {
  const found = ranks.filter((r): r is number => r != null)
  const top3 = found.filter((r) => r <= 3).length
  return {
    avgRank: found.length
      ? Math.round((found.reduce((a, b) => a + b, 0) / found.length) * 100) / 100
      : null,
    visibilityPct: ranks.length
      ? Math.round((top3 / ranks.length) * 10000) / 100
      : 0,
    ranked: found.length,
  }
}

/**
 * Local-pack convention shared by every grid map, whichever vendor produced
 * the data: 1–3 is the visible pack (green), 4–10 is page-one-ish but below the
 * fold (amber), 11–20 is present-but-invisible (red), absent is grey.
 *
 * Deliberately not a smooth gradient — the cliff between #3 and #4 is where the
 * clicks actually stop, and a gradient hides it.
 */
export function rankColor(rank: number | null): string {
  if (rank == null) return '#4b5563'
  if (rank <= 3) return '#16a34a'
  if (rank <= 10) return '#ca8a04'
  return '#dc2626'
}

export function rankTextColor(rank: number | null): string {
  return rank == null ? '#d1d5db' : '#ffffff'
}
