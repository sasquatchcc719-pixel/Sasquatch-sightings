/**
 * Shared logic for running a Radar SERP scan (used by cron and manual refresh).
 * Fetches rankings for all active keywords and inserts into radar_rankings.
 * Maps uses fixed town-center coordinates. Organic spot checks use an explicit
 * town-qualified query; Google Search Console supplies the historical trend.
 */

import { createAdminClient } from '@/supabase/server'
import { fetchMapsLocalFinder } from '@/lib/dataforseo'
import { fetchAuditedOrganicRanks } from '@/lib/radar-organic'
import {
  organicObservation,
  type OrganicAudit,
} from '@/lib/radar-organic-evidence'
import {
  buildMapsRankPanel,
  buildGoogleOrganicPanel,
  sameOrganicMethod,
  mountainDay,
  type GscDailyRow,
} from '@/lib/radar-history'
import { fetchRadarGoogleHistory } from '@/lib/radar-gsc-history'
import type { ReportCardInput } from '@/lib/reports/report-card'

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
          fetchAuditedOrganicRanks(kw.keyword, kw.location, domains),
          fetchMapsLocalFinder(kw.keyword, kw.location, domains),
        ])
        organicProviderCost += organic.cost

        const scannedAt = new Date().toISOString()
        const { data: scanRun, error: scanRunError } = await supabase
          .from('radar_scan_runs')
          .insert({
            keyword_id: kw.id,
            provider: 'serpapi-organic+dataforseo-maps',
            organic_audit: organic.audit,
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
  maps_checked_results?: number | null
}

export type MapsHistoryRow = {
  keyword_id: string
  finder_rank: number | null
  created_at: string
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
  const primaryDomain = (domains ?? []).find(
    (domain) =>
      domain.domain.replace(/^www\./, '') === PRIMARY_RADAR_DOMAIN &&
      domain.is_my_domain,
  )
  if (!primaryDomain) return null
  const { data: keywords, error: keywordError } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)
  if (keywordError) throw new Error(keywordError.message)
  if (!keywords?.length) return null
  const { data: ranks, error: rankError } = await supabase
    .from('radar_rankings')
    .select(
      'keyword_id, map_rank, finder_rank, rank_position, created_at, scan_run_id',
    )
    .in(
      'keyword_id',
      keywords.map((k) => k.id),
    )
    .eq('domain_id', primaryDomain.id)
    .gte('created_at', new Date(Date.now() - 100 * 86400000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1000)
  if (rankError) throw new Error(rankError.message)
  if (!ranks?.length) return null
  const rankRows = ranks as RankRow[]
  const runIds = [
    ...new Set(
      rankRows.flatMap((row) => (row.scan_run_id ? [row.scan_run_id] : [])),
    ),
  ]
  const { data: runs, error: runError } = runIds.length
    ? await supabase
        .from('radar_scan_runs')
        .select('id, organic_audit, radar_map_pack_snapshots(count)')
        .in('id', runIds)
    : { data: [], error: null }
  if (runError) throw new Error(runError.message)
  const mapsDepthByRun = new Map(
    (runs ?? []).map((run) => [
      run.id,
      run.radar_map_pack_snapshots?.[0]?.count ?? null,
    ]),
  )
  for (const row of rankRows)
    row.maps_checked_results = row.scan_run_id
      ? (mapsDepthByRun.get(row.scan_run_id) ?? null)
      : null
  const audits = new Map(
    (runs ?? []).map((run) => [
      run.id,
      run.organic_audit as OrganicAudit | null,
    ]),
  )
  const { data: gridData } = await supabase
    .from('local_falcon_scans')
    .select(
      'keyword, scanned_at, arp, solv, found_in, points_total, location, grid_size, radius, measurement, center_lat, center_lng',
    )
    .eq('platform', 'google')
    .order('scanned_at', { ascending: false })
    .limit(50)
  const grids = ((gridData ?? []) as LocalFalconRow[]).filter(
    (row) =>
      row.keyword.trim().toLowerCase() === 'carpet cleaning' &&
      localFalconBelongsToUs(row, [PRIMARY_RADAR_DOMAIN]),
  )
  const latestGrid = grids[0]
  const previousGrid = latestGrid
    ? grids.find(
        (row, index) => index > 0 && sameLocalFalconGrid(latestGrid, row),
      )
    : null
  const gridLine = latestGrid
    ? `MAPS SERVICE-AREA GRID · Local Falcon\nAverage rank ${latestGrid.arp?.toFixed(1) ?? '—'} · coverage ${latestGrid.found_in ?? '—'}/${latestGrid.points_total ?? '—'} points · visibility ${latestGrid.solv?.toFixed(1) ?? '—'}%${previousGrid?.solv != null && latestGrid.solv != null ? ` (previous ${previousGrid.solv.toFixed(1)}%)` : ''}`
    : 'MAPS SERVICE-AREA GRID · awaiting Local Falcon data'
  const mapsPanel = buildMapsRankPanel(keywords, rankRows)
  let googleHistory: GscDailyRow[] = []
  let googleUnavailable = false
  try {
    googleHistory = await fetchRadarGoogleHistory()
  } catch (error) {
    googleUnavailable = true
    console.error('[Radar] Google organic history unavailable', error)
  }
  const organicPanel = buildGoogleOrganicPanel(keywords, googleHistory)
  if (googleUnavailable) {
    organicPanel.subtitle =
      'Google history temporarily unavailable; no ranking-loss inference'
    organicPanel.series.forEach((series) => {
      series.latestLabel = 'History unavailable'
      series.coverageLabel = undefined
    })
  }
  const mapLines = mapsPanel.series.map((series) => {
    const points = series.points
    const latest = points.at(-1)
    const prior = points.at(-2)
    const rank = latest?.rank
    const move =
      rank != null && prior?.rank != null
        ? rank === prior.rank
          ? ' · unchanged'
          : rank < prior.rank
            ? ` · up ${prior.rank - rank}`
            : ` · down ${rank - prior.rank}`
        : ''
    return `• ${series.town}: ${series.latestLabel}${move}`
  })
  const organicLines = organicPanel.series.map((series) => {
    const current = series.points.at(-1)
    const prior = series.points.at(-2)
    const movement =
      current?.rank != null && prior?.rank != null
        ? ` · previous recorded ${prior.rank.toFixed(1)} (${prior.date.slice(5)})`
        : ''
    return `• ${series.town}: ${series.latestLabel}${series.coverageLabel ? ` · ${series.coverageLabel}` : ''}${movement}`
  })
  const spotLines = keywords.map((kw) => {
    const town = kw.location.split(',')[0].trim()
    const rows = rankRows.filter((row) => row.keyword_id === kw.id)
    const latest = rows[0]
    const audit = latest?.scan_run_id ? audits.get(latest.scan_run_id) : null
    if (audit?.version !== 2) return `• ${town}: new search check pending`
    const observation = organicObservation(audit, primaryDomain.id)
    const previous = rows
      .slice(1)
      .find(
        (row) =>
          row.scan_run_id &&
          sameOrganicMethod(audit, audits.get(row.scan_run_id)) &&
          mountainDay(row.created_at) !== mountainDay(latest.created_at),
      )
    const priorAudit = previous?.scan_run_id
      ? audits.get(previous.scan_run_id)
      : null
    const prior = organicObservation(priorAudit, primaryDomain.id)
    const value =
      observation.status === 'checked'
        ? `#${observation.rank}`
        : observation.status === 'not_seen'
          ? `not on checked pages (${observation.depth} results)`
          : 'check failed; no ranking conclusion'
    const movement =
      observation.rank != null && prior.rank != null
        ? observation.rank === prior.rank
          ? ' · unchanged'
          : observation.rank < prior.rank
            ? ` · up ${prior.rank - observation.rank}`
            : ` · down ${observation.rank - prior.rank}`
        : ''
    const failedDepth =
      audit.errors.length && observation.status === 'not_seen'
        ? ' · deeper search unavailable'
        : ''
    return `• ${town}: ${value}${movement}${failedDepth}`
  })
  const day = mountainDateKey()
  const date = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
  const text = [
    `Radar Daily · ${date}`,
    'MAPS · actual town-center rank today\n' + mapLines.join('\n'),
    'ORGANIC TREND · Google-recorded average position\n' +
      organicLines.join('\n'),
    gridLine,
    'Organic graph: US desktop searches naming each town, not searcher locations. Counts show reported impressions and measured weeks; gaps mean no reported data, not no ranking.',
    'ORGANIC SPOT CHECK · "carpet cleaning [town] co"\n' + spotLines.join('\n'),
    'Daily first-page checks; weekly Sunday pagination when absent. Wrong-topic/city responses are rejected. Graphs attached: town Maps ranks + 90-day Google organic history.',
  ].join('\n\n')
  const card: ReportCardInput = {
    eyebrow: 'Radar Daily',
    title: date,
    metrics: [],
    rankHistory: {
      date: day,
      panels: [mapsPanel, organicPanel],
      note: 'Organic: Google Search Console, US desktop, www + non-www. Town-named queries do not identify searcher location. Week dates are Mondays; edge weeks are partial. Latest data is delayed about 4 days. Gaps are not filled in. Maps misses require 20 checked results to confirm >20.',
    },
  }
  const lastRun = rankRows[0]?.scan_run_id ?? day
  return {
    text,
    caption: `Radar · ${date}\nTown-by-town Maps ranks and Google organic position history. Lower positions are better.`,
    card,
    runKey: `${day}-rank-history-v2-${lastRun}`,
  }
}

/** Text-only compatibility wrapper used by the Telegram admin dashboard. */
export async function buildRadarDigest(): Promise<string | null> {
  const report = await buildRadarDailyReport()
  return report?.text ?? null
}
