import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefSection } from './briefing'

// v1: all seven stored service-area lattice points within 3mi of the existing
// Monument anchor (39.0908,-104.8698), frozen from the 2026-11-02 scan.
// An operational sampling area, not municipal boundaries or a town-wide rank.
export const MONUMENT_CORE_POINTS = [
  [39.1301449275362, -104.867925478925],
  [39.1011594202899, -104.905283652616],
  [39.1011594202899, -104.867925478925],
  [39.1011594202899, -104.830567305233],
  [39.0721739130435, -104.905283652616],
  [39.0721739130435, -104.867925478925],
  [39.0721739130435, -104.830567305233],
] as const

type Point = {
  lat: number
  lng: number
  my_rank: number | null
  top_places: unknown
}
type Scan = {
  id: string
  status: string
  error: string | null
  created_at: string
  completed_at: string | null
  center_lat: number
  center_lng: number
  spacing_miles: number
  preset: string
  points_total: number
}
const key = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`
export function scoreMonumentCore(points: Point[]) {
  let valid = 0,
    top3 = 0,
    first = 0,
    missing = 0,
    invalid = 0
  for (const [lat, lng] of MONUMENT_CORE_POINTS) {
    const matches = points.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        key(p.lat, p.lng) === key(lat, lng),
    )
    if (!matches.length) {
      missing++
      continue
    }
    const p = matches[0]
    // Empty returned results cannot distinguish a true miss from a source gap.
    if (
      matches.length !== 1 ||
      !Array.isArray(p.top_places) ||
      !p.top_places.length ||
      (p.my_rank !== null &&
        (!Number.isInteger(p.my_rank) || p.my_rank < 1 || p.my_rank > 20))
    ) {
      invalid++
      continue
    }
    valid++
    if (p.my_rank !== null && p.my_rank <= 3) top3++
    if (p.my_rank === 1) first++
  }
  return { valid, top3, first, missing, invalid }
}
function sameMethod(scan: Scan) {
  return (
    scan.preset === 'service-area' &&
    scan.center_lat === 39.115 &&
    scan.center_lng === -104.78 &&
    scan.spacing_miles === 2 &&
    scan.points_total === 141
  )
}
const pct = (count: number, total: number) =>
  ((100 * count) / total).toFixed(1) + '%'
const definition =
  'DataForSEO Google Maps, query “carpet cleaning”. Core v1: seven fixed sampled locations within 3mi of Monument anchor 39.0908,-104.8698, on the existing 2mi service-area lattice. Operational area, not town boundaries or whole-town visibility. Coordinates frozen from Nov 2, 2026; no additional scans. '

export async function loadMonumentCore(
  db: SupabaseClient,
  now: Date,
): Promise<BriefSection> {
  const { data, error } = await db
    .from('radar_grid_scans')
    .select(
      'id,status,error,created_at,completed_at,center_lat,center_lng,spacing_miles,preset,points_total',
    )
    .eq('platform', 'google_maps')
    .eq('keyword', 'carpet cleaning')
    .order('created_at', { ascending: false })
    .limit(2)
  if (error) throw error
  const scans = (data ?? []) as Scan[]
  const base: BriefSection = {
    title: 'Monument core · Maps',
    state: 'unavailable',
    summary: 'No comparable core result available.',
    detail: definition,
    source:
      'DataForSEO · Google Maps · carpet cleaning · core v1 · coordinates ' +
      MONUMENT_CORE_POINTS.map(([lat, lng]) => key(lat, lng)).join('; '),
    measuredAt: scans[0]?.completed_at ?? scans[0]?.created_at ?? null,
    period: null,
  }
  if (!scans.length || !sameMethod(scans[0]))
    return {
      ...base,
      detail:
        definition +
        'Latest scan is absent or its grid method differs. No older result substituted.',
    }
  const scores = await Promise.all(
    scans.map(async (scan) => {
      const { data: points, error: pointError } = await db
        .from('radar_grid_points')
        .select('lat,lng,my_rank,top_places')
        .eq('scan_id', scan.id)
      if (pointError) throw pointError
      return scoreMonumentCore((points ?? []) as Point[])
    }),
  )
  const scan = scans[0],
    score = scores[0]
  const complete =
    score.valid === MONUMENT_CORE_POINTS.length &&
    scan.status === 'completed' &&
    !scan.error
  const timestamp = Date.parse(base.measuredAt ?? '')
  const fresh =
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() &&
    now.getTime() - timestamp <= 8 * 86400000
  const comparable =
    complete &&
    fresh &&
    scans[1] &&
    sameMethod(scans[1]) &&
    scans[1].status === 'completed' &&
    !scans[1].error &&
    scores[1].valid === 7 &&
    Date.parse(scans[1].completed_at ?? scans[1].created_at) < timestamp
  const comparison = comparable
    ? ` Previous comparable scan ${scans[1].created_at.slice(0, 10)}: ${scores[1].top3}/7 top 3 and ${scores[1].first}/7 #1. Observed change, not proof of SEO impact.`
    : ' No complete comparable prior result; no trend conclusion.'
  return {
    ...base,
    state:
      scan.error || scan.status === 'failed'
        ? 'failed'
        : !complete
          ? 'partial'
          : !fresh
            ? 'stale'
            : 'measured',
    summary: score.valid
      ? `${score.top3}/${score.valid} valid pins top 3 (${pct(score.top3, score.valid)}) · ${score.first}/${score.valid} #1 (${pct(score.first, score.valid)}).`
      : 'No valid core observations; no percentage available.',
    detail:
      `Measured ${(scan.completed_at ?? scan.created_at).slice(0, 10)}. ` +
      definition +
      `Coverage: ${score.valid}/7 valid; ${score.missing} missing; ${score.invalid} invalid/empty/duplicate. Scan status: ${scan.status}${scan.error ? '; scan reports errors' : ''}. ` +
      'Unranked pins with returned results stay in the denominator; they establish no exact rank. Missing or invalid pins are not ranking losses. ' +
      (!complete
        ? 'Partial sample only; do not compare its percentages with full coverage. '
        : '') +
      comparison,
    source:
      base.source +
      ' · current scan ' +
      scan.id +
      (scans[1] ? ' · previous scan ' + scans[1].id : ''),
  }
}
