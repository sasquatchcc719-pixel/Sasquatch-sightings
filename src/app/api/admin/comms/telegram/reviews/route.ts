import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { SASQUATCH_CID } from '@/lib/ops/gbp-review-sync'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const [
      { data: reviews },
      { data: missing },
      { data: pulls },
      { data: counts },
      { data: snapshots },
    ] = await Promise.all([
      supabase
        .from('gbp_reviews')
        .select(
          'review_id, author, rating, snippet, review_date_label, first_seen_at, last_seen_at, missing_since',
        )
        .is('missing_since', null)
        .order('first_seen_at', { ascending: false })
        .limit(12),
      supabase
        .from('gbp_reviews')
        .select('review_id, author, rating, snippet, missing_since')
        .not('missing_since', 'is', null)
        .order('missing_since', { ascending: false })
        .limit(20),
      supabase
        .from('gbp_review_pulls')
        .select(
          'pulled_at, aggregate_count, returned_count, rating_value, count_mismatch, newly_missing',
        )
        .order('pulled_at', { ascending: false })
        .limit(14),
      supabase
        .from('gbp_review_counts')
        .select('captured_on, total_on_google, stored_reviews')
        .order('captured_on', { ascending: false })
        .limit(30),
      supabase
        .from('gbp_profile_snapshots')
        .select('captured_at, rating_value, votes_count, reviews_returned')
        .order('captured_at', { ascending: false })
        .limit(1),
    ])

    const latestPull = pulls?.[0] ?? null
    const latestSnap = snapshots?.[0] ?? null
    let message: string | null = null
    if (latestPull?.newly_missing) {
      message = `${latestPull.newly_missing} Google review${latestPull.newly_missing === 1 ? '' : 's'} disappeared\n\nDisplayed count: ${latestPull.aggregate_count ?? '?'} · Reviews returned: ${latestPull.returned_count}`
    } else if (latestPull?.count_mismatch) {
      message = `Google review count desynced\n\nGoogle's displayed count (${latestPull.aggregate_count}) no longer matches the number of reviews it returns (${latestPull.returned_count}).`
    } else if (reviews?.[0]) {
      const stars =
        reviews[0].rating != null ? `${reviews[0].rating}★` : 'unrated'
      const quote = reviews[0].snippet
        ? `\n"${String(reviews[0].snippet).slice(0, 200)}"`
        : ''
      message = `New Google review — ${reviews[0].author || 'Anonymous'} (${stars})${quote}`
    }

    return NextResponse.json({
      cid: SASQUATCH_CID,
      lastSent: latestPull?.pulled_at ?? latestSnap?.captured_at ?? null,
      liveCount: latestSnap?.votes_count ?? latestPull?.aggregate_count ?? null,
      returnedCount:
        latestSnap?.reviews_returned ?? latestPull?.returned_count ?? null,
      rating: latestSnap?.rating_value ?? latestPull?.rating_value ?? null,
      mismatch: latestPull?.count_mismatch ?? false,
      missing: missing ?? [],
      reviews: reviews ?? [],
      pulls: pulls ?? [],
      counts: [...(counts ?? [])].reverse(),
      message,
    })
  } catch (err) {
    console.error('[admin/comms/telegram/reviews]', err)
    return NextResponse.json(
      { error: 'Failed to load reviews' },
      { status: 500 },
    )
  }
}
