/**
 * Weekly GSC ranking-baseline snapshot.
 *
 * Stores site-wide 28-day totals (clicks, impressions, CTR, avg position) for
 * both properties plus a fixed watchlist of priority unbranded keywords, then
 * reports the trend against the full stored history rather than a single prior
 * week. The wording, thresholds and verdict live in gsc-ranking-report.ts; this
 * module is the IO around them — pull from Google, persist, render, deliver.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSearchConsoleClient,
  queryTotals,
  queryKeywordRows,
  GSC_WWW_PROPERTY,
  GSC_SIGHTINGS_PROPERTY,
} from '@/lib/gsc'
import {
  buildGscReport,
  classifyKeyword,
  type KeywordCurrent,
  type KeywordSnapshot,
  type KeywordVerdict,
  type SiteSnapshot,
} from '@/lib/gsc-ranking-report'
import { deliverReportCard } from '@/lib/reports/telegram-report'
import {
  fetchWatchlistKeywords,
  RANKING_DATA_LAG_DAYS as DATA_LAG_DAYS,
  RANKING_WINDOW_DAYS as WINDOW_DAYS,
} from '@/lib/gsc-watchlist'

/** Weeks of history to pull for trend and record-run detection. */
const HISTORY_LIMIT = 12

export type RankingBaselineResult = {
  digest: string
  imageUrl: string | null
}

async function fetchPriorSiteSnapshots(
  supabase: SupabaseClient,
  property: string,
): Promise<SiteSnapshot[]> {
  const { data } = await supabase
    .from('gsc_ranking_snapshots')
    .select('clicks, impressions, ctr, avg_position, checked_at')
    .eq('property', property)
    .order('checked_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  return (data || []) as SiteSnapshot[]
}

/** One query for the whole watchlist, grouped in memory (newest first). */
async function fetchPriorKeywordSnapshots(
  supabase: SupabaseClient,
  keywords: string[],
): Promise<Map<string, KeywordSnapshot[]>> {
  if (keywords.length === 0) return new Map()

  const { data } = await supabase
    .from('gsc_keyword_snapshots')
    .select('keyword, page, clicks, impressions, avg_position, checked_at')
    .in('keyword', keywords)
    .order('checked_at', { ascending: false })
    .limit(HISTORY_LIMIT * keywords.length)

  const grouped = new Map<string, KeywordSnapshot[]>()
  for (const row of (data || []) as KeywordSnapshot[]) {
    const bucket = grouped.get(row.keyword)
    if (bucket) bucket.push(row)
    else grouped.set(row.keyword, [row])
  }
  return grouped
}

export async function runGscRankingBaseline(
  supabase: SupabaseClient,
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
    /** Skip the image and post text only (used by scripts and dry runs). */
    textOnly?: boolean
    now?: Date
  } = {},
): Promise<RankingBaselineResult> {
  const now = options.now ?? new Date()
  const dataThrough = new Date(now.getTime() - DATA_LAG_DAYS * 86_400_000)
  const sc = getSearchConsoleClient()

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

  // Editable from Comms → Telegram (and Marketing → Search Rankings), so the
  // report tracks whatever is on the list at run time.
  const watchlist = await fetchWatchlistKeywords(supabase, GSC_WWW_PROPERTY)
  const watchlistKeywords = watchlist.map((row) => row.keyword)

  const [wwwHistory, sightingsHistory, keywordHistory] = await Promise.all([
    fetchPriorSiteSnapshots(supabase, GSC_WWW_PROPERTY),
    fetchPriorSiteSnapshots(supabase, GSC_SIGHTINGS_PROPERTY),
    fetchPriorKeywordSnapshots(supabase, watchlistKeywords),
  ])

  // Watchlist keyword positions (www property only — that's where the
  // priority local terms live).
  const keywordRows = await queryKeywordRows(
    sc,
    GSC_WWW_PROPERTY,
    WINDOW_DAYS + DATA_LAG_DAYS,
    DATA_LAG_DAYS,
  )
  const bestPerKeyword = new Map<string, KeywordCurrent>()
  for (const row of keywordRows) {
    const key = row.keyword.toLowerCase()
    if (!watchlistKeywords.includes(key)) continue
    const existing = bestPerKeyword.get(key)
    if (!existing || row.impressions > existing.impressions) {
      bestPerKeyword.set(key, row)
    }
  }

  const verdicts: KeywordVerdict[] = []
  const keywordSnapshotInserts: Array<Record<string, unknown>> = []
  let keywordClicks = 0

  for (const keyword of watchlistKeywords) {
    const current = bestPerKeyword.get(keyword) ?? null
    keywordClicks += current?.clicks ?? 0

    verdicts.push(
      classifyKeyword({
        keyword,
        current,
        history: keywordHistory.get(keyword) ?? [],
      }),
    )

    keywordSnapshotInserts.push({
      property: GSC_WWW_PROPERTY,
      keyword,
      page: current?.page ?? null,
      clicks: current?.clicks ?? 0,
      impressions: current?.impressions ?? 0,
      // NULL, never 0 — a stored 0 used to read as "position zero" next week
      // and turned a keyword's return into a phantom ranking collapse.
      avg_position: current?.position ?? null,
    })
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

  const report = buildGscReport({
    now,
    dataThrough,
    windowDays: WINDOW_DAYS,
    main: { current: wwwTotals, history: wwwHistory },
    secondary: {
      label: 'Sightings site',
      current: sightingsTotals,
      history: sightingsHistory,
    },
    keywords: verdicts,
    keywordClicks,
    footerNote: 'Source: Google Search Console · sasquatchcarpet.com',
  })

  // Text-only path keeps the old injectable contract for scripts and tests.
  if (options.textOnly || options.notifyOwner) {
    const notify = options.notifyOwner
    if (notify) {
      await notify([report.caption, '', report.text].join('\n')).catch((err) =>
        console.error('[gsc-ranking-baseline] owner notify failed:', err),
      )
      return { digest: report.text, imageUrl: null }
    }
  }

  const delivery = await deliverReportCard({
    supabase,
    slug: 'gsc-ranking',
    runKey: now.toISOString().slice(0, 10),
    card: report.card,
    caption: report.caption,
    text: report.text,
  })

  return { digest: report.text, imageUrl: delivery.imageUrl }
}
