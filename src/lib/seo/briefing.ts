import type { SupabaseClient } from '@supabase/supabase-js'
import type { searchconsole_v1 } from 'googleapis'
import { getSearchConsoleClient, GSC_WWW_PROPERTY } from '@/lib/gsc'
import {
  completedWeeks,
  dateKey,
  type EvidenceState,
  type Period,
} from './reporting'

export type BriefSection = {
  title: string
  state: EvidenceState
  summary: string
  detail: string
  source: string
  measuredAt: string | null
  period: Period | null
}
export type ChangeRow = {
  id: string
  occurred_at: string
  category: string
  title: string
  detail: string | null
  external_ref: string | null
  seo_change?: unknown
}
export type SeoBriefing = {
  generatedAt: string
  sections: BriefSection[]
  changes: ChangeRow[]
  changeHistoryError: boolean
  nextActions: string[]
}
const DAY = 86_400_000
function localDay(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
function daysBefore(day: string, count: number) {
  return new Date(Date.parse(dateKey(day) + 'T12:00:00Z') - count * DAY)
    .toISOString()
    .slice(0, 10)
}
function unavailable(
  title: string,
  source: string,
  detail: string,
): BriefSection {
  return {
    title,
    source,
    state: 'unavailable',
    summary: 'No verified result available.',
    detail,
    measuredAt: null,
    period: null,
  }
}
async function organic(
  sc: searchconsole_v1.Searchconsole,
  now: Date,
): Promise<BriefSection> {
  const today = localDay(now, 'America/Los_Angeles')
  // The latest returned FINAL observation is evidence of availability, not an
  // assumed lag. Missing dates remain absent; we never create zero-rank rows.
  const { data } = await sc.searchanalytics.query(
    {
      siteUrl: GSC_WWW_PROPERTY,
      requestBody: {
        startDate: daysBefore(today, 60),
        endDate: today,
        dimensions: ['date'],
        dataState: 'final',
        type: 'web',
        rowLimit: 100,
      },
    },
    { timeout: 15000 },
  )
  const dates = (data.rows ?? [])
    .flatMap((row) => (row.keys?.[0] ? [dateKey(row.keys[0])] : []))
    .filter((date) => date <= today)
    .sort()
  const through = dates.at(-1)
  if (!through)
    return unavailable(
      'Organic search',
      'Google Search Console · www property · web · all devices',
      'No final dated observations returned. No ranking-loss or zero-traffic conclusion.',
    )
  const periods = completedWeeks(through)
  const totals = await Promise.all(
    [periods.current, periods.previous].map(async (period) => {
      const result = await sc.searchanalytics.query(
        {
          siteUrl: GSC_WWW_PROPERTY,
          requestBody: {
            startDate: period.start,
            endDate: period.end,
            dataState: 'final',
            type: 'web',
            rowLimit: 1,
          },
        },
        { timeout: 15000 },
      )
      return result.data.rows?.[0] ?? null
    }),
  )
  const row = totals[0],
    prior = totals[1]
  if (!row)
    return {
      ...unavailable(
        'Organic search',
        GSC_WWW_PROPERTY,
        'No aggregate row returned for this completed week; absence is not a measured zero.',
      ),
      period: periods.current,
    }
  const valid = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!valid(row.clicks) || !valid(row.impressions))
    throw new Error('Invalid GSC aggregate')
  const stale = through < daysBefore(today, 7)
  const change =
    !stale && prior && valid(prior.clicks)
      ? ' Prior week: ' +
        prior.clicks +
        ' clicks (' +
        periods.previous.start +
        ' to ' +
        periods.previous.end +
        ').'
      : ' No comparable prior-week click total available.'
  return {
    title: 'Organic search',
    state: stale ? 'stale' : 'measured',
    summary: row.clicks + ' clicks · ' + row.impressions + ' impressions.',
    detail:
      'Final data observed through ' +
      through +
      '. Exact non-overlapping Monday–Sunday periods, Pacific time.' +
      change +
      ' This is site-wide web search, not a Monument rank or a Maps result.',
    source:
      GSC_WWW_PROPERTY +
      ' · Search Console · web · all countries/devices · final data',
    measuredAt: now.toISOString(),
    period: periods.current,
  }
}
async function maps(db: SupabaseClient, now: Date): Promise<BriefSection> {
  const { data: scans, error } = await db
    .from('radar_grid_scans')
    .select(
      'id,keyword,status,error,created_at,completed_at,points_total,points_scanned,center_lat,center_lng,spacing_miles,preset',
    )
    .eq('platform', 'google_maps')
    .eq('keyword', 'carpet cleaning')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const scan = scans?.[0]
  if (!scan)
    return unavailable(
      'Maps visibility',
      'DataForSEO · stored service-area grid',
      'No scan recorded. This page does not start a paid scan.',
    )
  const { data: points, error: pointError } = await db
    .from('radar_grid_points')
    .select('row_idx,col_idx,my_rank')
    .eq('scan_id', scan.id)
  if (pointError) throw pointError
  const rows = points ?? []
  const unique = new Set(rows.map((p) => p.row_idx + ':' + p.col_idx))
  const invalid = rows.some(
    (p) =>
      p.my_rank !== null &&
      (!Number.isInteger(p.my_rank) || p.my_rank < 1 || p.my_rank > 20),
  )
  const complete =
    scan.status === 'completed' &&
    !scan.error &&
    scan.points_total > 0 &&
    scan.points_scanned === scan.points_total &&
    rows.length === scan.points_total &&
    unique.size === scan.points_total &&
    !invalid
  const observed = Date.parse(scan.completed_at ?? scan.created_at)
  const stale =
    !Number.isFinite(observed) ||
    observed > now.getTime() ||
    now.getTime() - observed > 8 * DAY
  const state: EvidenceState =
    scan.status === 'failed' || scan.error
      ? 'failed'
      : !complete
        ? 'partial'
        : stale
          ? 'stale'
          : 'measured'
  const top3 = rows.filter(
    (p) => p.my_rank !== null && p.my_rank >= 1 && p.my_rank <= 3,
  ).length
  return {
    title: 'Maps visibility',
    state,
    summary: complete
      ? top3 + ' of ' + scan.points_total + ' grid points in the top 3.'
      : rows.length +
        ' stored points of ' +
        scan.points_total +
        ' expected; no coverage conclusion.',
    detail:
      'Latest carpet-cleaning grid. ' +
      (complete
        ? 'Null ranks mean no rank recorded in returned data, not zero. They do not establish an exact position or rule out source-data gaps. '
        : 'Latest attempt is incomplete or failed; do not treat missing points as ranking losses. ') +
      'Different grids and keywords are not compared. Expected weekly cadence; evidence older than eight days is flagged stale.',
    source:
      'radar_grid_scans/' +
      scan.id +
      ' · DataForSEO Google Maps · ' +
      scan.preset +
      ' · center ' +
      scan.center_lat +
      ',' +
      scan.center_lng +
      ' · spacing ' +
      scan.spacing_miles +
      'mi',
    measuredAt: scan.completed_at ?? scan.created_at,
    period: null,
  }
}
async function business(db: SupabaseClient): Promise<BriefSection> {
  const { data: newest, error } = await db
    .from('marketing_weekly_rollup')
    .select('week_start,week_end')
    .order('week_start', { ascending: false })
    .limit(1)
  if (error) throw error
  const week = newest?.[0]
  if (!week)
    return unavailable(
      'Business outcomes',
      'Existing marketing weekly rollup',
      'No stored weekly business rollup available. No SEO revenue attribution is inferred.',
    )
  const { data: rows, error: rowsError } = await db
    .from('marketing_weekly_rollup')
    .select('quote_sessions,residential_jobs,commercial_jobs,built_at')
    .eq('week_start', week.week_start)
  if (rowsError) throw rowsError
  if (
    !rows?.length ||
    rows.some(
      (r) =>
        r.quote_sessions == null ||
        !Number.isFinite(Number(r.quote_sessions)) ||
        Number(r.quote_sessions) < 0,
    )
  )
    return unavailable(
      'Business outcomes',
      'marketing_weekly_rollup',
      'Stored quote-session rows are missing or invalid. No zero or SEO impact is inferred.',
    )
  return {
    title: 'Business outcomes',
    state: 'partial',
    summary:
      (rows ?? []).reduce((sum, r) => sum + Number(r.quote_sessions ?? 0), 0) +
      ' recorded quote sessions across the existing rollup.',
    detail:
      'This is a different reporting window and is not qualified SEO leads, new-customer revenue or proof of SEO impact. Attribution and business-source completeness still need verification; no revenue or weekly SEO gain is claimed.',
    source: 'marketing_weekly_rollup · all recorded towns',
    measuredAt: rows?.[0]?.built_at ?? null,
    period: { start: week.week_start, end: week.week_end },
  }
}
/** Read-only: existing stored Maps/business evidence and Google final analytics.
 * No scans, indexing submissions, sends or writes.
 */
export async function loadSeoBriefing(
  db: SupabaseClient,
  options: {
    now?: Date
    searchConsole?: () => searchconsole_v1.Searchconsole
  } = {},
): Promise<SeoBriefing> {
  const now = options.now ?? new Date()
  const work = [
    () => maps(db, now),
    () => organic((options.searchConsole ?? getSearchConsoleClient)(), now),
    () => business(db),
  ]
  const titles = ['Maps visibility', 'Organic search', 'Business outcomes']
  const sections = await Promise.all(
    work.map(async (run, index) => {
      try {
        return await run()
      } catch (err) {
        console.error('[seo briefing] ' + titles[index] + ' unavailable', err)
        return {
          ...unavailable(
            titles[index],
            'Source could not be read',
            'Read failed. No performance conclusion; existing collection and schedules were not changed.',
          ),
          state: 'failed' as const,
        }
      }
    }),
  )
  // Structured evidence is additive; deploy the ledger migration before this release.
  const { data, error } = await db
    .from('marketing_events')
    .select('id,occurred_at,category,title,detail,external_ref,seo_change')
    .in('category', ['website', 'gbp', 'instrument'])
    .order('occurred_at', { ascending: false })
    .limit(10)
  return {
    generatedAt: now.toISOString(),
    sections,
    changes: error ? [] : (data ?? []),
    changeHistoryError: Boolean(error),
    nextActions: [
      'Prioritize the Monument page and record the exact deployed change with a baseline.',
      sections.some((s) =>
        ['failed', 'partial', 'unavailable', 'stale'].includes(s.state),
      )
        ? 'Resolve evidence gaps before interpreting changes as SEO gains or losses.'
        : 'Review the next complete comparable week before choosing another change.',
    ],
  }
}
