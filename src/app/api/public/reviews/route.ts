/**
 * GET /api/public/reviews
 * Public, cached list of real 5-star Google reviews (with text) sourced from
 * our own gbp_reviews table, which the track-serps cron syncs daily from the
 * Google Business Profile listing. Powers the marketing site's review carousel
 * so it auto-updates as new reviews come in — no manual editing.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const GOOGLE_LISTING_URL = 'https://maps.google.com/?cid=9526859716651434570'
const MAX_REVIEWS = 15

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('gbp_reviews')
      .select('review_id, author, rating, snippet, review_date_label')
      .eq('rating', 5)
      .not('snippet', 'is', null)
      .order('first_seen_at', { ascending: false })
      .limit(60)

    if (error) throw new Error(error.message)

    const reviews = (data || [])
      // Only reviews with a substantive quote
      .filter((r) => (r.snippet ?? '').trim().length >= 40)
      .slice(0, MAX_REVIEWS)
      .map((r) => ({
        id: r.review_id,
        author: r.author,
        rating: Number(r.rating),
        text: (r.snippet ?? '').trim(),
        dateLabel: r.review_date_label ?? null,
      }))

    return NextResponse.json(
      {
        reviews,
        count: reviews.length,
        url: GOOGLE_LISTING_URL,
        source: 'gbp_reviews_daily_sync',
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
        },
      },
    )
  } catch (err) {
    console.error('[public/reviews] Error:', err)
    return NextResponse.json(
      { reviews: [], count: 0, error: 'Reviews unavailable' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    )
  }
}
