/**
 * The keyword watchlist behind the weekly Google Search report.
 *
 * GET returns each keyword with its current position and trend, computed by the
 * same classifier the Telegram report uses, so the page and the message can
 * never tell different stories.
 *
 * POST adds a keyword and immediately reconstructs its history from Search
 * Console, so a new term shows a real trend on the next report instead of
 * spending two months saying "no views yet".
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { getSearchConsoleClient, GSC_WWW_PROPERTY } from '@/lib/gsc'
import {
  backfillKeywordHistory,
  DEFAULT_BACKFILL_WEEKS,
} from '@/lib/gsc-watchlist'
import { classifyKeyword, type KeywordSnapshot } from '@/lib/gsc-ranking-report'

const MAX_KEYWORD_LENGTH = 120

/** Search Console reports queries lowercase; the report matches exactly. */
function normalizeKeyword(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const { data: keywordRows, error: keywordError } = await supabase
      .from('gsc_watchlist_keywords')
      .select('id, keyword, property, active, notes, backfilled_at, created_at')
      .eq('property', GSC_WWW_PROPERTY)
      .order('created_at', { ascending: true })
    if (keywordError) throw keywordError

    const keywords = keywordRows ?? []
    if (keywords.length === 0) {
      return NextResponse.json({ keywords: [] })
    }

    const { data: snapshotRows, error: snapshotError } = await supabase
      .from('gsc_keyword_snapshots')
      .select('keyword, page, clicks, impressions, avg_position, checked_at')
      .in(
        'keyword',
        keywords.map((row) => row.keyword),
      )
      .eq('property', GSC_WWW_PROPERTY)
      .order('checked_at', { ascending: false })
    if (snapshotError) throw snapshotError

    const grouped = new Map<string, KeywordSnapshot[]>()
    for (const row of (snapshotRows ?? []) as KeywordSnapshot[]) {
      const bucket = grouped.get(row.keyword)
      if (bucket) bucket.push(row)
      else grouped.set(row.keyword, [row])
    }

    const enriched = keywords.map((row) => {
      const history = grouped.get(row.keyword) ?? []
      const [latest, ...prior] = history
      const hasCurrent =
        latest != null && latest.avg_position != null && latest.impressions > 0

      const verdict = classifyKeyword({
        keyword: row.keyword,
        current: hasCurrent
          ? {
              keyword: row.keyword,
              page: latest.page ?? '',
              clicks: latest.clicks,
              impressions: latest.impressions,
              position: Number(latest.avg_position),
            }
          : null,
        history: prior,
      })

      return {
        id: row.id,
        keyword: row.keyword,
        active: row.active,
        notes: row.notes,
        backfilledAt: row.backfilled_at,
        createdAt: row.created_at,
        weeksTracked: history.length,
        page: hasCurrent ? latest.page : null,
        position: hasCurrent ? Number(latest.avg_position) : null,
        impressions: hasCurrent ? latest.impressions : 0,
        clicks: hasCurrent ? latest.clicks : 0,
        verdict,
        // Oldest-first so the sparkline reads left to right.
        trend: [...history].reverse().map((snapshot) => ({
          date: snapshot.checked_at,
          position:
            snapshot.avg_position == null || Number(snapshot.avg_position) <= 0
              ? null
              : Number(snapshot.avg_position),
          impressions: snapshot.impressions,
        })),
      }
    })

    return NextResponse.json({ keywords: enriched })
  } catch (err) {
    console.error('[admin/search-rankings/keywords][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load keyword watchlist' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const body = await request.json()
    const keyword = normalizeKeyword(body.keyword)

    if (keyword.length < 2 || keyword.length > MAX_KEYWORD_LENGTH) {
      return NextResponse.json(
        {
          error: `Enter a keyword between 2 and ${MAX_KEYWORD_LENGTH} characters`,
        },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('gsc_watchlist_keywords')
      .insert({
        keyword,
        property: GSC_WWW_PROPERTY,
        notes:
          typeof body.notes === 'string' ? body.notes.trim() || null : null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'That keyword is already on the watchlist' },
          { status: 409 },
        )
      }
      throw error
    }

    // Pulling history is the whole point of adding a keyword here, but a failed
    // backfill should not undo the add — the next cron run still tracks it.
    let backfill: { inserted: number; skipped: number } | null = null
    let backfillError: string | null = null
    try {
      backfill = await backfillKeywordHistory({
        supabase,
        sc: getSearchConsoleClient(),
        keyword,
        property: GSC_WWW_PROPERTY,
        weeks: DEFAULT_BACKFILL_WEEKS,
      })
    } catch (err) {
      console.error('[admin/search-rankings/keywords][POST] backfill', err)
      backfillError =
        err instanceof Error ? err.message : 'History backfill failed'
    }

    return NextResponse.json(
      { keyword: data, backfill, backfillError },
      {
        status: 201,
      },
    )
  } catch (err) {
    console.error('[admin/search-rankings/keywords][POST]', err)
    return NextResponse.json(
      { error: 'Failed to add keyword' },
      { status: 500 },
    )
  }
}
