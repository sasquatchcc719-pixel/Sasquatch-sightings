/**
 * GET /api/public/review-stats
 * Public, cached review statistics sourced from our own gbp_reviews table
 * (synced daily from the Google Business Profile listing by the track-serps
 * cron). Consumed by the marketing site's review badge, JSON-LD, and llms.txt
 * so the site never shows a stale hardcoded count again.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const GOOGLE_LISTING_URL = 'https://maps.google.com/?cid=9526859716651434570'

export async function GET() {
  try {
    const supabase = createAdminClient()
    const [{ count }, { data: ratings }, { data: latest }] = await Promise.all([
      supabase.from('gbp_reviews').select('*', { count: 'exact', head: true }),
      supabase.from('gbp_reviews').select('rating').not('rating', 'is', null),
      supabase
        .from('gbp_reviews')
        .select('first_seen_at')
        .order('first_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const values = (ratings || []).map((r) => Number(r.rating))
    const avg =
      values.length > 0
        ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
          10
        : null

    if (!count || count === 0 || avg === null) {
      return NextResponse.json(
        { error: 'No review data synced yet' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        rating: avg,
        reviewCount: count,
        url: GOOGLE_LISTING_URL,
        source: 'gbp_reviews_daily_sync',
        lastSyncedAt: latest?.first_seen_at ?? null,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
        },
      },
    )
  } catch (err) {
    console.error('[review-stats] Error:', err)
    return NextResponse.json({ error: 'Stats unavailable' }, { status: 500 })
  }
}
