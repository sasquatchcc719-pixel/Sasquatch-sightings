/**
 * The editable keyword watchlist behind the weekly ranking report.
 *
 * Adding a keyword here used to mean waiting weeks before its trend meant
 * anything. Search Console keeps roughly 16 months of history, so a new keyword
 * gets its past weeks reconstructed on the spot — the same 28-day trailing
 * windows the cron would have recorded, stamped with the dates it would have
 * recorded them.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { searchconsole_v1 } from 'googleapis'
import { queryKeywordRowsBetween, GSC_WWW_PROPERTY } from '@/lib/gsc'

/**
 * The snapshot cadence. The weekly cron and the backfill must agree on these
 * or a reconstructed week would not be comparable to a recorded one.
 */
export const RANKING_WINDOW_DAYS = 28
/** Search Console data lags ~2-3 days; never ask for the freshest days. */
export const RANKING_DATA_LAG_DAYS = 3
/** How far back a newly added keyword gets reconstructed. */
export const DEFAULT_BACKFILL_WEEKS = 8

const DAY_MS = 86_400_000

export type WatchlistKeyword = {
  id: string
  keyword: string
  property: string
  active: boolean
  notes: string | null
  backfilled_at: string | null
  created_at: string
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Active watchlist keywords, oldest first so report ordering is stable. */
export async function fetchWatchlistKeywords(
  supabase: SupabaseClient,
  property: string = GSC_WWW_PROPERTY,
): Promise<WatchlistKeyword[]> {
  const { data, error } = await supabase
    .from('gsc_watchlist_keywords')
    .select('id, keyword, property, active, notes, backfilled_at, created_at')
    .eq('property', property)
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[gsc-watchlist] failed to load keywords:', error)
    return []
  }
  return (data || []) as WatchlistKeyword[]
}

/**
 * The trailing window the cron would have used for a snapshot taken `weeksAgo`
 * weeks before `now`.
 */
export function snapshotWindow(
  now: Date,
  weeksAgo: number,
): { checkedAt: Date; startDate: string; endDate: string } {
  const checkedAt = new Date(now.getTime() - weeksAgo * 7 * DAY_MS)
  const end = new Date(checkedAt.getTime() - RANKING_DATA_LAG_DAYS * DAY_MS)
  const start = new Date(end.getTime() - RANKING_WINDOW_DAYS * DAY_MS)
  return { checkedAt, startDate: isoDay(start), endDate: isoDay(end) }
}

/**
 * Reconstruct a keyword's weekly snapshots from Search Console history.
 *
 * Weeks that already have a snapshot are skipped, so this is safe to re-run and
 * safe to call on a keyword that was previously tracked and re-added.
 */
export async function backfillKeywordHistory(params: {
  supabase: SupabaseClient
  sc: searchconsole_v1.Searchconsole
  keyword: string
  property?: string
  weeks?: number
  now?: Date
}): Promise<{ inserted: number; skipped: number }> {
  const {
    supabase,
    sc,
    keyword,
    property = GSC_WWW_PROPERTY,
    weeks = DEFAULT_BACKFILL_WEEKS,
    now = new Date(),
  } = params

  const { data: existing } = await supabase
    .from('gsc_keyword_snapshots')
    .select('checked_at')
    .eq('keyword', keyword)
    .eq('property', property)
  const existingTimes = (existing || []).map((row) =>
    Date.parse(row.checked_at as string),
  )
  /** Within three days counts as the same weekly slot. */
  const alreadyHave = (at: Date) =>
    existingTimes.some((time) => Math.abs(time - at.getTime()) < 3 * DAY_MS)

  const inserts: Array<Record<string, unknown>> = []
  let skipped = 0

  for (let weeksAgo = weeks; weeksAgo >= 1; weeksAgo -= 1) {
    const { checkedAt, startDate, endDate } = snapshotWindow(now, weeksAgo)
    if (alreadyHave(checkedAt)) {
      skipped += 1
      continue
    }

    let rows
    try {
      rows = await queryKeywordRowsBetween(
        sc,
        property,
        startDate,
        endDate,
        25,
        keyword,
      )
    } catch (error) {
      console.error(
        `[gsc-watchlist] backfill query failed for "${keyword}" ${startDate}..${endDate}:`,
        error,
      )
      continue
    }

    // Google returns one row per landing page; keep the page that carried the
    // keyword, matching how the weekly cron picks a winner.
    const best = rows.reduce<(typeof rows)[number] | null>(
      (winner, row) =>
        !winner || row.impressions > winner.impressions ? row : winner,
      null,
    )

    inserts.push({
      property,
      keyword,
      page: best?.page ?? null,
      clicks: best?.clicks ?? 0,
      impressions: best?.impressions ?? 0,
      // NULL, never 0 — 0 would read as "ranked first" in trend math.
      avg_position: best && best.impressions > 0 ? best.position : null,
      checked_at: checkedAt.toISOString(),
    })
  }

  if (inserts.length > 0) {
    const { error } = await supabase
      .from('gsc_keyword_snapshots')
      .insert(inserts)
    if (error) {
      console.error('[gsc-watchlist] backfill insert failed:', error)
      return { inserted: 0, skipped }
    }
  }

  await supabase
    .from('gsc_watchlist_keywords')
    .update({ backfilled_at: new Date().toISOString() })
    .eq('keyword', keyword)
    .eq('property', property)

  return { inserted: inserts.length, skipped }
}
