/**
 * Weekly GSC ranking-baseline snapshot.
 * Stores site-wide 28-day totals (clicks, impressions, CTR, avg position) for
 * both properties plus a fixed watchlist of priority unbranded keywords that
 * are currently off page 1. Diffs against the prior weekly snapshot (WoW) and
 * the snapshot closest to 28 days back (MoM) so Charles can see whether the
 * SEO push is actually moving the needle, not just index coverage.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSearchConsoleClient,
  queryTotals,
  queryKeywordRows,
  GSC_WWW_PROPERTY,
  GSC_SIGHTINGS_PROPERTY,
  type GscTotals,
} from '@/lib/gsc'
import { sendTelegramNotification } from '@/lib/telegram'

const WINDOW_DAYS = 28
/** GSC data lags ~2-3 days; never ask for the freshest days. */
const DATA_LAG_DAYS = 3
/** How far back a "month ago" comparison snapshot may be to still count. */
const MOM_TARGET_DAYS = 28
const MOM_TOLERANCE_DAYS = 6

/**
 * Priority unbranded keywords that have real impression volume but are
 * stuck off page 1 (see the baseline pull from 2026-07-02). Update this list
 * as terms move onto page 1 or new targets emerge.
 */
export const RANKING_WATCHLIST_KEYWORDS = [
  'carpet cleaners colorado springs',
  'area rug cleaning near me',
  'best carpet cleaners in colorado springs',
  'best carpet cleaner in colorado springs',
  'carpet cleaner colorado springs',
  'briargate cleaning',
]

type SiteSnapshotRow = {
  property: string
  window_days: number
  clicks: number
  impressions: number
  ctr: number
  avg_position: number
  checked_at: string
}

type KeywordSnapshotRow = {
  property: string
  keyword: string
  page: string | null
  clicks: number
  impressions: number
  avg_position: number
  checked_at: string
}

export type RankingBaselineResult = {
  digest: string
}

function pctDelta(current: number, prior: number): string {
  if (prior === 0) return current === 0 ? '0%' : 'new'
  const pct = ((current - prior) / prior) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(0)}%`
}

function posDelta(current: number, prior: number): string {
  const diff = prior - current // positive = improved (moved up = lower number)
  if (Math.abs(diff) < 0.05) return 'flat'
  const sign = diff >= 0 ? '↑' : '↓'
  return `${sign}${Math.abs(diff).toFixed(1)}`
}

async function fetchPriorSiteSnapshots(
  supabase: SupabaseClient,
  property: string,
): Promise<SiteSnapshotRow[]> {
  const { data } = await supabase
    .from('gsc_ranking_snapshots')
    .select('*')
    .eq('property', property)
    .order('checked_at', { ascending: false })
    .limit(12)
  return (data || []) as SiteSnapshotRow[]
}

async function fetchPriorKeywordSnapshots(
  supabase: SupabaseClient,
  keyword: string,
): Promise<KeywordSnapshotRow[]> {
  const { data } = await supabase
    .from('gsc_keyword_snapshots')
    .select('*')
    .eq('keyword', keyword)
    .order('checked_at', { ascending: false })
    .limit(12)
  return (data || []) as KeywordSnapshotRow[]
}

function findMomRow<T extends { checked_at: string }>(rows: T[]): T | null {
  let best: T | null = null
  let bestDiff = Infinity
  for (const row of rows) {
    const ageDays = (Date.now() - Date.parse(row.checked_at)) / 86_400_000
    const diff = Math.abs(ageDays - MOM_TARGET_DAYS)
    if (diff < bestDiff && ageDays >= MOM_TARGET_DAYS - MOM_TOLERANCE_DAYS) {
      best = row
      bestDiff = diff
    }
  }
  return best
}

function shortPath(url: string): string {
  return (
    url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '') || '/'
  )
}

function buildSiteLines(
  label: string,
  current: GscTotals,
  wow: SiteSnapshotRow | null,
  mom: SiteSnapshotRow | null,
): string[] {
  const lines = [`${label} (${WINDOW_DAYS}d):`]
  lines.push(
    `  Clicks: ${current.clicks}` +
      (wow ? ` · WoW ${pctDelta(current.clicks, wow.clicks)}` : '') +
      (mom ? ` · MoM ${pctDelta(current.clicks, mom.clicks)}` : ''),
  )
  lines.push(
    `  Impressions: ${current.impressions}` +
      (wow ? ` · WoW ${pctDelta(current.impressions, wow.impressions)}` : '') +
      (mom ? ` · MoM ${pctDelta(current.impressions, mom.impressions)}` : ''),
  )
  lines.push(
    `  Avg CTR: ${(current.ctr * 100).toFixed(1)}%` +
      (wow ? ` · WoW ${pctDelta(current.ctr, wow.ctr)}` : '') +
      (mom ? ` · MoM ${pctDelta(current.ctr, mom.ctr)}` : ''),
  )
  lines.push(
    `  Avg position: ${current.position.toFixed(1)}` +
      (wow ? ` · WoW ${posDelta(current.position, wow.avg_position)}` : '') +
      (mom ? ` · MoM ${posDelta(current.position, mom.avg_position)}` : ''),
  )
  return lines
}

export async function runGscRankingBaseline(
  supabase: SupabaseClient,
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
  } = {},
): Promise<RankingBaselineResult> {
  const notifyOwner =
    options.notifyOwner ??
    ((text: string) => sendTelegramNotification(text, { disablePreview: true }))

  const sc = getSearchConsoleClient()

  // Site-wide totals for both properties.
  const [wwwTotals, sightingsTotals] = await Promise.all([
    queryTotals(
      sc,
      GSC_WWW_PROPERTY,
      WINDOW_DAYS + DATA_LAG_DAYS,
      DATA_LAG_DAYS,
    ),
    queryTotals(
      sc,
      GSC_SIGHTINGS_PROPERTY,
      WINDOW_DAYS + DATA_LAG_DAYS,
      DATA_LAG_DAYS,
    ),
  ])

  const [wwwPrior, sightingsPrior] = await Promise.all([
    fetchPriorSiteSnapshots(supabase, GSC_WWW_PROPERTY),
    fetchPriorSiteSnapshots(supabase, GSC_SIGHTINGS_PROPERTY),
  ])
  const wwwWow = wwwPrior[0] ?? null
  const wwwMom = findMomRow(wwwPrior)
  const sightingsWow = sightingsPrior[0] ?? null
  const sightingsMom = findMomRow(sightingsPrior)

  // Watchlist keyword positions (www property only — that's where the
  // priority local terms live).
  const keywordRows = await queryKeywordRows(
    sc,
    GSC_WWW_PROPERTY,
    WINDOW_DAYS + DATA_LAG_DAYS,
    DATA_LAG_DAYS,
  )
  const bestPerKeyword = new Map<
    string,
    {
      keyword: string
      page: string
      clicks: number
      impressions: number
      position: number
    }
  >()
  for (const row of keywordRows) {
    const key = row.keyword.toLowerCase()
    if (!RANKING_WATCHLIST_KEYWORDS.includes(key)) continue
    const existing = bestPerKeyword.get(key)
    if (!existing || row.impressions > existing.impressions) {
      bestPerKeyword.set(key, row)
    }
  }

  const keywordLines: string[] = []
  const keywordSnapshotInserts: Array<Record<string, unknown>> = []
  for (const keyword of RANKING_WATCHLIST_KEYWORDS) {
    const found = bestPerKeyword.get(keyword)
    const priorRows = await fetchPriorKeywordSnapshots(supabase, keyword)
    const wow = priorRows[0] ?? null
    const mom = findMomRow(priorRows)

    if (found) {
      const deltas = [
        wow ? `WoW ${posDelta(found.position, wow.avg_position)}` : null,
        mom ? `MoM ${posDelta(found.position, mom.avg_position)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      keywordLines.push(
        `  "${keyword}" — pos ${found.position.toFixed(1)} · ${found.impressions} impr${deltas ? ` · ${deltas}` : ''} (${shortPath(found.page)})`,
      )
      keywordSnapshotInserts.push({
        property: GSC_WWW_PROPERTY,
        keyword,
        page: found.page,
        clicks: found.clicks,
        impressions: found.impressions,
        avg_position: found.position,
      })
    } else {
      keywordLines.push(`  "${keyword}" — no impressions this window`)
      keywordSnapshotInserts.push({
        property: GSC_WWW_PROPERTY,
        keyword,
        page: null,
        clicks: 0,
        impressions: 0,
        avg_position: 0,
      })
    }
  }

  // Persist this week's snapshot after reading priors above.
  const { error: siteInsertError } = await supabase
    .from('gsc_ranking_snapshots')
    .insert([
      {
        property: GSC_WWW_PROPERTY,
        window_days: WINDOW_DAYS,
        clicks: wwwTotals.clicks,
        impressions: wwwTotals.impressions,
        ctr: wwwTotals.ctr,
        avg_position: wwwTotals.position,
      },
      {
        property: GSC_SIGHTINGS_PROPERTY,
        window_days: WINDOW_DAYS,
        clicks: sightingsTotals.clicks,
        impressions: sightingsTotals.impressions,
        ctr: sightingsTotals.ctr,
        avg_position: sightingsTotals.position,
      },
    ])
  if (siteInsertError)
    console.error(
      '[gsc-ranking-baseline] site snapshot insert failed:',
      siteInsertError,
    )

  if (keywordSnapshotInserts.length > 0) {
    const { error: keywordInsertError } = await supabase
      .from('gsc_keyword_snapshots')
      .insert(keywordSnapshotInserts)
    if (keywordInsertError)
      console.error(
        '[gsc-ranking-baseline] keyword snapshot insert failed:',
        keywordInsertError,
      )
  }

  const lines = [
    `📈 GSC Ranking Baseline`,
    ...buildSiteLines('Main site', wwwTotals, wwwWow, wwwMom),
    '',
    ...buildSiteLines('Sightings', sightingsTotals, sightingsWow, sightingsMom),
    '',
    `Watchlist keywords (unbranded, off page 1):`,
    ...keywordLines,
  ]
  const digest = lines.join('\n')

  await notifyOwner(digest).catch((err) =>
    console.error('[gsc-ranking-baseline] owner notify failed:', err),
  )

  return { digest }
}
