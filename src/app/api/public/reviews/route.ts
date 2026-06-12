/**
 * GET /api/public/reviews
 * Real 5-star Google reviews for the marketing site's testimonial carousel.
 *
 * PRIMARY source = LIVE Google Business Profile API (the same OAuth Echo posts
 * with) — real reviewer names, real timestamps, current data straight from
 * Google. Falls back to the daily-synced gbp_reviews table only if the live
 * call fails, so the carousel never goes blank.
 *
 * Public, CORS, edge-cached 1h.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { fetchLiveGoogleReviews } from '@/lib/google-business'

const GOOGLE_LISTING_URL = 'https://maps.google.com/?cid=9526859716651434570'
const MAX_REVIEWS = 15
const MIN_LEN = 40

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
}

type OutReview = {
  id: string
  author: string
  rating: number
  text: string
  dateLabel: string | null
}

function relativeLabel(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const days = Math.floor((Date.now() - then) / 86400000)
  if (days < 7) return 'this week'
  if (days < 14) return 'a week ago'
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) {
    const m = Math.max(1, Math.floor(days / 30))
    return m === 1 ? 'a month ago' : `${m} months ago`
  }
  const y = Math.floor(days / 365)
  return y === 1 ? 'a year ago' : `${y} years ago`
}

export async function GET() {
  // PRIMARY: live Google Business Profile API
  try {
    const live = await fetchLiveGoogleReviews(50)
    const reviews: OutReview[] = live
      .filter((r) => r.rating === 5 && r.text.length >= MIN_LEN)
      .slice(0, MAX_REVIEWS)
      .map((r) => ({
        id: r.id,
        author: r.author,
        rating: r.rating,
        text: r.text,
        dateLabel: relativeLabel(r.updateTime ?? r.createTime),
      }))

    if (reviews.length > 0) {
      return NextResponse.json(
        {
          reviews,
          count: reviews.length,
          url: GOOGLE_LISTING_URL,
          source: 'gbp_live_api',
        },
        { headers: CORS },
      )
    }
  } catch (err) {
    console.error('[public/reviews] live GBP fetch failed, falling back:', err)
  }

  // FALLBACK: daily-synced snapshot table
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

    const reviews: OutReview[] = (data || [])
      .filter((r) => (r.snippet ?? '').trim().length >= MIN_LEN)
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
      { headers: CORS },
    )
  } catch (err) {
    console.error('[public/reviews] fallback failed:', err)
    return NextResponse.json(
      { reviews: [], count: 0, error: 'Reviews unavailable' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    )
  }
}
