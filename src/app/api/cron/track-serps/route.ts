/**
 * Radar SERP tracking cron job. Also syncs Google Business Profile reviews
 * (new reviews → Telegram notice to Charles; reviewer names let the review
 * request engine skip customers who already reviewed).
 * Schedule in vercel.json. Requires CRON_SECRET and SERPAPI_API_KEY.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runRadarScan } from '@/lib/radar-scan'
import { syncGbpReviews } from '@/lib/gbp-reviews'
import { createAdminClient } from '@/supabase/server'
import { sendToCharles } from '@/lib/harry-command-bot'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runRadarScan()

    let reviewSync: { newReviews: number; totalOnGoogle: number | null } = {
      newReviews: 0,
      totalOnGoogle: null,
    }
    try {
      const supabase = createAdminClient()
      const sync = await syncGbpReviews(supabase)
      reviewSync = {
        newReviews: sync.newReviews.length,
        totalOnGoogle: sync.totalOnGoogle,
      }
      for (const review of sync.newReviews.slice(0, 10)) {
        const stars = review.rating != null ? `${review.rating}★` : 'unrated'
        const quote = review.snippet
          ? `\n"${review.snippet.slice(0, 200)}"`
          : ''
        await sendToCharles(
          `🌟 New Google review — ${review.author || 'Anonymous'} (${stars})${quote}${
            sync.totalOnGoogle != null
              ? `\nTotal reviews: ${sync.totalOnGoogle}`
              : ''
          }`,
        )
      }
    } catch (reviewErr) {
      // Review sync failures must not break rank tracking.
      console.error('[Radar Cron] GBP review sync failed:', reviewErr)
    }

    return NextResponse.json({ ...result, review_sync: reviewSync })
  } catch (err) {
    console.error('[Radar Cron] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
