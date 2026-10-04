/**
 * Shared logic for running a Radar SERP scan (used by cron and manual refresh).
 * Fetches rankings for all active keywords and inserts into radar_rankings.
 * Organic rank and Maps local finder both use DataForSEO from fixed town
 * centroids, so the two daily readings share one location and device model.
 */

import { createAdminClient } from '@/supabase/server'
import { fetchMapsLocalFinder, fetchOrganicRanks } from '@/lib/dataforseo'
import type { ReportCardInput, ReportCardTone } from '@/lib/reports/report-card'

const PRIMARY_RADAR_DOMAIN = 'sasquatchcarpet.com'

export type RadarScanResult = {
  success: boolean
  keywords_processed: number
  keywords_available?: number
  keywords_deferred?: number
  keywords_succeeded?: number
  keywords_failed?: number
  rankings_inserted: number
  organic_provider_cost?: number
  message?: string
  /** Provider, persistence, or completeness details when success is false. */
  error_detail?: string
}

export async function runRadarScan(): Promise<RadarScanResult> {
  const supabase = createAdminClient()

  const { data: keywords, error: kwError } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)

  if (kwError) {
    throw new Error(`Failed to fetch keywords: ${kwError.message}`)
  }

  const { data: domains, error: domError } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')

  if (domError || !domains?.length) {
    throw new Error(
      domError
        ? `Failed to fetch domains: ${domError.message}`
        : 'No domains configured',
    )
  }

  if (!keywords?.length) {
    return {
      success: true,
      keywords_processed: 0,
      rankings_inserted: 0,
      message: 'No active keywords',
    }
  }

  let rankingsInserted = 0
  let organicProviderCost = 0
  const failures: string[] = []
  let keywordsSucceeded = 0

  await Promise.all(
    keywords.map(async (kw) => {
      let scanRunId: string | null = null
      try {
        // These are independent provider calls. Running all towns concurrently
        // keeps one slow request from consuming the five-minute cron budget.
        const [organic, { mapPack, ranksByDomainId }] = await Promise.all([
          fetchOrganicRanks(kw.keyword, kw.location, domains),
          fetchMapsLocalFinder(kw.keyword, kw.location, domains),
        ])
        organicProviderCost += organic.cost

        const scannedAt = new Date().toISOString()
        const { data: scanRun, error: scanRunError } = await supabase
          .from('radar_scan_runs')
          .insert({
            keyword_id: kw.id,
            provider: 'dataforseo',
            device: organic.device,
            latitude: organic.lat,
            longitude: organic.lng,
            requested_depth: organic.requestedDepth,
            returned_depth: organic.returnedDepth,
            provider_task_id: organic.taskId,
            provider_cost: organic.cost,
            created_at: scannedAt,
          })
          .select('id')
          .single()
        if (scanRunError) {
          throw new Error(
            `Scan metadata insert failed: ${scanRunError.message}`,
          )
        }
        scanRunId = scanRun.id

        const rows = organic.ranks.map((r) => {
          const finderRank = ranksByDomainId.get(r.domain_id) ?? null
          return {
            keyword_id: kw.id,
            domain_id: r.domain_id,
            rank_position: r.rank_position,
            scan_run_id: scanRun.id,
            created_at: scannedAt,
            // Two DIFFERENT Google surfaces — never compare or merge them.
            // This scan no longer requests the web local 3-pack, so pack_rank is
            // deliberately blank. finder_rank is the Maps local finder (1–20).
            // map_rank remains its deprecated compatibility alias.
            pack_rank: null,
            finder_rank: finderRank,
            // Deprecated, kept equal to finder_rank so existing readers behave.
            map_rank: finderRank,
          }
        })
        // Append the complete organic result set. History is intentionally kept:
        // it is the evidence needed to audit a surprising rank change.
        if (organic.snapshot.length > 0) {
          const { error: snapshotError } = await supabase
            .from('radar_serp_snapshots')
            .insert(
              organic.snapshot.map((s) => ({
                keyword_id: kw.id,
                scan_run_id: scanRun.id,
                position: s.position,
                domain: s.domain,
                created_at: scannedAt,
                ...(s.rating != null && { rating: s.rating }),
                ...(s.reviews != null && { reviews: s.reviews }),
                ...(s.address && { address: s.address }),
              })),
            )
          if (snapshotError) {
            throw new Error(
              `Organic snapshot insert failed: ${snapshotError.message}`,
            )
          }
        }

        // Persist the full Maps local finder (top ~20, with review counts) as
        // history so the review gap vs competitors is trackable over time.
        if (mapPack.length > 0) {
          const { error: mapPackError } = await supabase
            .from('radar_map_pack_snapshots')
            .insert(
              mapPack.map((p) => ({
                keyword_id: kw.id,
                scan_run_id: scanRun.id,
                position: p.position,
                title: p.title,
                domain: p.domain,
                rating: p.rating,
                reviews: p.reviews,
                address: p.address,
                created_at: scannedAt,
              })),
            )
          if (mapPackError) {
            throw new Error(
              `Maps snapshot insert failed: ${mapPackError.message}`,
            )
          }
        }

        // Rankings are the final write. If any audit snapshot failed above, the
        // scan run is deleted and cannot masquerade as a complete observation.
        const { error: insertError } = await supabase
          .from('radar_rankings')
          .insert(rows)
        if (insertError)
          throw new Error(`Rankings insert failed: ${insertError.message}`)

        rankingsInserted += rows.length
        keywordsSucceeded += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const failure = `${kw.location}: ${msg}`
        failures.push(failure)
        console.error(
          `[Radar Scan] failed for "${kw.keyword}" (${kw.location}):`,
          err,
        )
        if (scanRunId) {
          const { error: cleanupError } = await supabase
            .from('radar_scan_runs')
            .delete()
            .eq('id', scanRunId)
          if (cleanupError) {
            console.error(
              `[Radar Scan] cleanup failed for run ${scanRunId}:`,
              cleanupError,
            )
          }
        }
      }
    }),
  )

  const expectedRows = keywords.length * domains.length
  const success =
    failures.length === 0 &&
    keywordsSucceeded === keywords.length &&
    rankingsInserted === expectedRows
  if (!success && failures.length === 0) {
    failures.push(
      `Incomplete scan: ${keywordsSucceeded}/${keywords.length} towns and ` +
        `${rankingsInserted}/${expectedRows} ranking rows completed`,
    )
  }

  return {
    success,
    keywords_processed: keywords.length,
    keywords_available: keywords.length,
    keywords_deferred: 0,
    keywords_succeeded: keywordsSucceeded,
    keywords_failed: failures.length,
    rankings_inserted: rankingsInserted,
    organic_provider_cost: Number(organicProviderCost.toFixed(4)),
    error_detail: failures.length ? failures.join(' | ') : undefined,
  }
}

/** How deep the Maps town-centre sample checks. */
const MAPS_DEPTH = 20
const ORGANIC_MISS_FLOOR = 51
// DataForSEO's fixed town-centre coordinates replaced SerpApi's town-name
// search on this date. Earlier finder_rank rows are real observations, but
// they are not comparable enough to put on the same progress graph.
const MAPS_COMPARABLE_SINCE = '2026-08-10'

type RankRow = {
  keyword_id: string
  map_rank: number | null
  finder_rank: number | null
  rank_position: number | null
  created_at: string
  scan_run_id: string | null
}

export type MapsHistoryRow = {
  keyword_id: string
  finder_rank: number | null
  created_at: string
}

type ScanRunRow = {
  id: string
  provider: string
  requested_depth: number
  returned_depth: number
  created_at: string
}

type RankSample = {
  value: number | null
  createdAt: string
  scanRunId: string | null
}

type LocalFalconRow = {
  keyword: string
  scanned_at: string
  arp: number | null
  solv: number | null
  found_in: number | null
  points_total: number | null
  location: unknown
  grid_size: number | null
  radius: number | null
  measurement: string | null
  center_lat: number | null
  center_lng: number | null
}

export type RadarDailyReport = {
  text: string
  caption: string
  card: ReportCardInput
  runKey: string
}

/**
 * Three-scan median with misses placed just beyond the measured depth. One bad
 * sample cannot turn a real rank into "not found"; two consecutive misses can.
 */
export function rollingMedianRank(
  values: Array<number | null>,
  missFloor: number,
): number | null {
  if (values.length === 0) return null
  if (values.length < 3) return values[0]
  const sorted = values
    .slice(0, 3)
    .map((value) => value ?? missFloor)
    .sort((a, b) => a - b)
  const median = sorted[1]
  return median >= missFloor ? null : median
}

export function summarizeOrganicSamples(
  values: Array<number | null>,
  window = 7,
): {
  latest: number | null
  typicalWhenFound: number | null
  found: number
  total: number
} {
  const recent = values.slice(0, window)
  const ranked = recent.filter((value): value is number => value != null)
  return {
    latest: recent[0] ?? null,
    typicalWhenFound: ranked.length ? Math.round(median(ranked)) : null,
    found: ranked.length,
    total: recent.length,
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function mondayFor(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  const daysFromMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysFromMonday)
  return date.toISOString().slice(0, 10)
}

/**
 * Build a fixed-scale weekly history from the comparable Maps local-finder
 * era. A town counts as visible when its median daily position for the week is
 * within the top 20. Weeks missing any tracked town are omitted rather than
 * quietly changing the denominator.
 */
export function buildWeeklyMapsVisibility(
  rows: MapsHistoryRow[],
  keywordIds: string[],
): Array<{ label: string; value: number }> {
  const daily = new Map<string, number | null>()
  for (const row of rows) {
    const dateKey = row.created_at.slice(0, 10)
    if (dateKey < MAPS_COMPARABLE_SINCE) continue
    const key = `${dateKey}:${row.keyword_id}`
    const existing = daily.get(key)
    if (
      !daily.has(key) ||
      (row.finder_rank != null &&
        (existing == null || row.finder_rank < existing))
    ) {
      daily.set(key, row.finder_rank)
    }
  }

  const weeklyTownRanks = new Map<string, number[]>()
  const weeks = new Set<string>()
  for (const [key, rank] of daily) {
    const separator = key.indexOf(':')
    const dateKey = key.slice(0, separator)
    const keywordId = key.slice(separator + 1)
    const week = mondayFor(dateKey)
    weeks.add(week)
    const weeklyKey = `${week}:${keywordId}`
    const values = weeklyTownRanks.get(weeklyKey) ?? []
    values.push(rank ?? MAPS_DEPTH + 1)
    weeklyTownRanks.set(weeklyKey, values)
  }

  return [...weeks]
    .sort()
    .flatMap((week) => {
      const townMedians = keywordIds.map((keywordId) => {
        const values = weeklyTownRanks.get(`${week}:${keywordId}`)
        return values?.length ? median(values) : null
      })
      if (townMedians.some((value) => value == null)) return []
      const visible = townMedians.filter(
        (value) => value != null && value <= MAPS_DEPTH,
      ).length
      return [
        {
          label: shortDate(`${week}T12:00:00Z`),
          value: visible,
        },
      ]
    })
    .slice(-13)
}

function bestRank(rows: RankRow[], metric: 'map' | 'organic'): number | null {
  const positions = rows
    .map((row) => {
      if (metric === 'map') return row.map_rank
      // Before scan_run_id existed, 50 was the fake not-found sentinel. New
      // scans store NULL, so a provider-backed #50 is now allowed through.
      if (row.scan_run_id == null && row.rank_position === 50) return null
      return row.rank_position
    })
    .filter((value): value is number => value != null)
  return positions.length ? Math.min(...positions) : null
}

function samplesFor(rows: RankRow[], metric: 'map' | 'organic'): RankSample[] {
  const groups = new Map<
    string,
    { rows: RankRow[]; createdAt: string; scanRunId: string | null }
  >()
  for (const row of rows) {
    const key = row.scan_run_id ?? row.created_at
    const group = groups.get(key) ?? {
      rows: [],
      createdAt: row.created_at,
      scanRunId: row.scan_run_id,
    }
    group.rows.push(row)
    if (row.created_at > group.createdAt) group.createdAt = row.created_at
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((group) => ({
      value: bestRank(group.rows, metric),
      createdAt: group.createdAt,
      scanRunId: group.scanRunId,
    }))
}

function arrowFor(values: Array<number | null>, missFloor: number): string {
  if (values.length < 4) return ''
  const current = rollingMedianRank(values, missFloor) ?? missFloor
  const previous = rollingMedianRank(values.slice(1), missFloor) ?? missFloor
  if (current < previous) return ' ↑'
  if (current > previous) return ' ↓'
  return ''
}

function localFalconBelongsToUs(
  row: LocalFalconRow,
  myDomains: string[],
): boolean {
  if (!row.location || typeof row.location !== 'object') return false
  const location = row.location as Record<string, unknown>
  const url = String(location.url ?? location.display_url ?? '').toLowerCase()
  return myDomains.some((domain) => url.includes(domain))
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
}

function sameLocalFalconGrid(a: LocalFalconRow, b: LocalFalconRow): boolean {
  const sameCoordinate = (left: number | null, right: number | null) =>
    left == null || right == null
      ? left === right
      : Math.abs(left - right) < 0.0001

  return (
    a.grid_size === b.grid_size &&
    a.radius === b.radius &&
    a.measurement === b.measurement &&
    sameCoordinate(a.center_lat, b.center_lat) &&
    sameCoordinate(a.center_lng, b.center_lng)
  )
}

function mountainDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`
}

/**
 * Build the daily Telegram report and its phone-sized progress image.
 *
 * The daily Maps rows are explicitly labelled as fixed town-centre samples.
 * The progress graph shows every comparable week (up to 13) from the fixed-
 * coordinate era; Local Falcon remains the service-area coverage metric in
 * the summary tiles.
 */
export async function buildRadarDailyReport(): Promise<RadarDailyReport | null> {
  const supabase = createAdminClient()

  const { data: domains } = await supabase
    .from('radar_domains')
    .select('id, domain, is_my_domain')
  const mine = (domains ?? []).filter((domain) => domain.is_my_domain)
  const primaryDomain = mine.find(
    (domain) =>
      domain.domain.toLowerCase().replace(/^www\./, '') ===
      PRIMARY_RADAR_DOMAIN,
  )
  if (!primaryDomain) return null
  const myDomainIds = [primaryDomain.id]
  const myDomains = [PRIMARY_RADAR_DOMAIN]

  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)
  if (!keywords?.length) return null

  const since = new Date(Date.now() - 100 * 86_400_000).toISOString()
  const { data: ranks } = await supabase
    .from('radar_rankings')
    .select(
      'keyword_id, map_rank, finder_rank, rank_position, created_at, scan_run_id',
    )
    .in(
      'keyword_id',
      keywords.map((k) => k.id),
    )
    .in('domain_id', myDomainIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (!ranks?.length) return null
  const rankRows = ranks as RankRow[]
  const weeklyMapsVisibility = buildWeeklyMapsVisibility(
    rankRows,
    keywords.map((keyword) => keyword.id),
  )

  const runIds = [
    ...new Set(
      rankRows
        .map((row) => row.scan_run_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const { data: scanRuns } = runIds.length
    ? await supabase
        .from('radar_scan_runs')
        .select('id, provider, requested_depth, returned_depth, created_at')
        .in('id', runIds)
    : { data: [] }
  const scanRunById = new Map(
    ((scanRuns ?? []) as ScanRunRow[]).map((run) => [run.id, run]),
  )

  const { data: localFalconData } = await supabase
    .from('local_falcon_scans')
    .select(
      'keyword, scanned_at, arp, solv, found_in, points_total, location, grid_size, radius, measurement, center_lat, center_lng',
    )
    .eq('platform', 'google')
    .order('scanned_at', { ascending: false })
    .limit(50)
  const localFalconCandidates = (
    (localFalconData ?? []) as LocalFalconRow[]
  ).filter(
    (row) =>
      row.keyword.trim().toLowerCase() === 'carpet cleaning' &&
      localFalconBelongsToUs(row, myDomains),
  )
  const newestLocalFalconGrid = localFalconCandidates[0]
  const localFalcon = newestLocalFalconGrid
    ? localFalconCandidates
        .filter((row) => sameLocalFalconGrid(row, newestLocalFalconGrid))
        .slice(0, 6)
    : []

  const fmtMap = (p: number | null) =>
    p == null ? `not in top ${MAPS_DEPTH}` : `#${p}`
  const fmtOrganic = (p: number | null, depth: number) =>
    p == null ? `not found in ${depth} checked` : `#${p}`

  const mapGroups = new Map<string, string[]>()
  const organicGroups = new Map<string, string[]>()
  const mapCurrent: Array<{ town: string; rank: number | null }> = []
  const organicCurrent: Array<{ town: string; rank: number | null }> = []

  for (const kw of keywords) {
    const keywordRows = rankRows.filter((row) => row.keyword_id === kw.id)
    if (!keywordRows.length) continue
    const town = kw.location.split(',')[0].trim()

    for (const metric of ['map', 'organic'] as const) {
      // Once a trustworthy DataForSEO organic run exists, never compare it to
      // the legacy first-page SerpApi rows. That would manufacture a provider-
      // switch "movement" on day one.
      const rowsForMetric =
        metric === 'organic' &&
        keywordRows.some(
          (row) =>
            row.scan_run_id != null &&
            scanRunById.get(row.scan_run_id)?.provider === 'dataforseo',
        )
          ? keywordRows.filter(
              (row) =>
                row.scan_run_id != null &&
                scanRunById.get(row.scan_run_id)?.provider === 'dataforseo',
            )
          : keywordRows
      const samples = samplesFor(rowsForMetric, metric)
      const values = samples.map((sample) => sample.value)
      const missFloor = metric === 'map' ? MAPS_DEPTH + 1 : ORGANIC_MISS_FLOOR
      const organicSummary = summarizeOrganicSamples(values)
      const current =
        metric === 'map'
          ? rollingMedianRank(values, missFloor)
          : organicSummary.latest
      const arrow = metric === 'map' ? arrowFor(values, missFloor) : ''
      const newestRun = samples[0]?.scanRunId
        ? scanRunById.get(samples[0].scanRunId!)
        : null
      const returnedDepth = newestRun?.returned_depth ?? 50
      const icon =
        current === 1
          ? '🥇'
          : current == null
            ? '⚠️'
            : current <= 3
              ? '🟢'
              : '•'
      const value =
        metric === 'map'
          ? fmtMap(current)
          : `${fmtOrganic(current, returnedDepth)} · seen ${organicSummary.found}/${organicSummary.total}` +
            (organicSummary.typicalWhenFound == null
              ? ''
              : ` · typical #${organicSummary.typicalWhenFound} when found`)
      const baseline =
        samples.length < (metric === 'map' ? 3 : 7) ? ' · new baseline' : ''
      const line = `${icon} ${town}: ${value}${arrow}${baseline}`
      const groups = metric === 'map' ? mapGroups : organicGroups
      const list = groups.get(kw.keyword) ?? []
      list.push(line)
      groups.set(kw.keyword, list)

      if (metric === 'map') mapCurrent.push({ town, rank: current })
      else organicCurrent.push({ town, rank: current })
    }
  }
  if (mapGroups.size === 0 && organicGroups.size === 0) return null

  const date = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
  const block = (groups: Map<string, string[]>) =>
    [...groups.entries()]
      .map(([keyword, lines]) => `📍 ${keyword}\n${lines.join('\n')}`)
      .join('\n\n')

  const parts = [`🗺️ Radar Daily · ${date}`]
  if (mapGroups.size > 0) {
    parts.push(
      `— Google Maps Business Profile rank · town-center spot check · 3-scan median (top ${MAPS_DEPTH}) —\n${block(mapGroups)}`,
    )
  }
  if (organicGroups.size > 0) {
    parts.push(
      `— Website organic rank · latest desktop spot check + 7-scan context (top 50) —\n${block(organicGroups)}`,
    )
  }
  if (mapGroups.size > 0 && organicGroups.size > 0) {
    parts.push(
      `Maps and website organic are separate Google result systems. Their rank numbers are not comparable.`,
    )
  }

  const latestGrid = localFalcon[0]
  const previousGrid = localFalcon[1]
  if (latestGrid) {
    const coverage =
      latestGrid.found_in != null && latestGrid.points_total
        ? `${latestGrid.found_in}/${latestGrid.points_total} points`
        : 'coverage unavailable'
    parts.push(
      `— Local Falcon service-area grid —\n` +
        `Average rank ${latestGrid.arp?.toFixed(1) ?? '—'} · ` +
        `SoLV ${latestGrid.solv?.toFixed(1) ?? '—'}% · ${coverage}\n` +
        (previousGrid
          ? `This comparable grid trend is the best Maps progress signal; town rows above are single points.`
          : `New grid baseline; wait for the same grid configuration before calling movement.`),
    )
  }
  parts.push(
    `🥇 #1 · 🟢 top 3 · ⚠️ not found · arrows apply only to the 3-scan Maps trend`,
  )

  const mapVisible = mapCurrent.filter((row) => row.rank != null).length
  const organicVisible = organicCurrent.filter((row) => row.rank != null).length
  const bestMap = mapCurrent
    .filter((row): row is { town: string; rank: number } => row.rank != null)
    .sort((a, b) => a.rank - b.rank)[0]
  const coveragePct =
    latestGrid?.found_in != null && latestGrid.points_total
      ? Math.round((latestGrid.found_in / latestGrid.points_total) * 100)
      : null
  const solvChange =
    latestGrid?.solv != null && previousGrid?.solv != null
      ? latestGrid.solv - previousGrid.solv
      : null
  let tone: ReportCardTone = 'neutral'
  let verdict = latestGrid
    ? 'Latest Local Falcon grid is a new comparison baseline.'
    : 'Local Falcon is awaiting a comparable service-area grid.'
  if (solvChange != null && solvChange >= 1) {
    tone = 'good'
    verdict = `Local Maps visibility improved ${solvChange.toFixed(1)} points.`
  } else if (solvChange != null && solvChange <= -1) {
    tone = 'warn'
    verdict = `Local Maps visibility slipped ${Math.abs(solvChange).toFixed(1)} points.`
  } else if (solvChange != null) {
    verdict = 'Local Maps visibility is holding steady.'
  }

  const card: ReportCardInput = {
    eyebrow: 'Radar Daily',
    title: date,
    subtitle:
      `${weeklyMapsVisibility.length}-week fixed-location Maps history · ` +
      'separate website organic spot check · service-area grid',
    verdict: { text: verdict, tone },
    metrics: [
      {
        label: 'Best town center',
        value: bestMap ? `#${bestMap.rank}` : 'Out',
        note: bestMap?.town ?? 'No top-20 town sample',
        tone: bestMap?.rank === 1 ? 'good' : 'neutral',
      },
      {
        label: 'Map towns visible',
        value: `${mapVisible}/${mapCurrent.length}`,
        note: 'Fixed town-center samples',
        tone: 'neutral',
      },
      {
        label: 'Organic towns visible',
        value: `${organicVisible}/${organicCurrent.length}`,
        note: 'Real multi-page crawl',
        tone: 'neutral',
      },
      {
        label: 'Grid coverage',
        value: coveragePct != null ? `${coveragePct}%` : '—',
        note:
          latestGrid?.found_in != null && latestGrid.points_total
            ? `${latestGrid.found_in} of ${latestGrid.points_total} points`
            : 'Awaiting Local Falcon',
        tone: coveragePct != null && coveragePct >= 80 ? 'good' : 'neutral',
      },
    ],
    series:
      weeklyMapsVisibility.length > 0
        ? {
            label: `Town centers visible in Maps top 20 (of ${keywords.length})`,
            points: weeklyMapsVisibility,
            maxValue: keywords.length,
          }
        : null,
    footer:
      'Maps and website organic ranks are separate. Grid coverage is Local Falcon.',
  }

  const caption = [
    `Radar · ${date}`,
    verdict,
    weeklyMapsVisibility.length > 0
      ? `${weeklyMapsVisibility.length}-week fixed-location Maps history attached`
      : null,
    latestGrid
      ? `Grid: rank ${latestGrid.arp?.toFixed(1) ?? '—'} · ${coveragePct ?? '—'}% coverage`
      : null,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    text: parts.join('\n\n'),
    caption,
    card,
    runKey: mountainDateKey(),
  }
}

/** Text-only compatibility wrapper used by the Telegram admin dashboard. */
export async function buildRadarDigest(): Promise<string | null> {
  const report = await buildRadarDailyReport()
  return report?.text ?? null
}
