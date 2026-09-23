/**
 * Radar SERP tracking cron job. Also syncs Google Business Profile reviews
 * (new reviews → Telegram notice to Charles; reviewer names let the review
 * request engine skip customers who already reviewed).
 * Schedule in vercel.json. Requires CRON_SECRET and DataForSEO credentials.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runRadarScan, buildRadarDailyReport } from '@/lib/radar-scan'
import { syncGbpReviews } from '@/lib/gbp-reviews'
import {
  formatReviewCountChange,
  recordReviewCount,
} from '@/lib/gbp-review-count'
import { createAdminClient } from '@/supabase/server'
import { sendTelegramNotification } from '@/lib/telegram'
import { deliverReportCard } from '@/lib/reports/telegram-report'

export const maxDuration = 300

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
        await sendTelegramNotification(
          `🌟 New Google review — ${review.author || 'Anonymous'} (${stars})${quote}${
            sync.totalOnGoogle != null
              ? `\nShowing on Google: ${sync.totalOnGoogle}`
              : ''
          }`,
        )
      }

      // Snapshot the public count and speak up only when it moves — during a
      // profile reinstatement this is the number Charles is waiting on.
      const { count: storedReviews } = await supabase
        .from('gbp_reviews')
        .select('id', { count: 'exact', head: true })
      const change = await recordReviewCount(
        supabase,
        sync.totalOnGoogle,
        storedReviews ?? 0,
      )
      if (change) {
        const text = formatReviewCountChange(change, storedReviews ?? 0)
        if (text) await sendTelegramNotification(text)
      }
    } catch (reviewErr) {
      // Review sync failures must not break rank tracking.
      console.error('[Radar Cron] GBP review sync failed:', reviewErr)
    }

    // Daily Telegram report: a graph image first, then the detailed rank text.
    // Never let a report failure break rank tracking.
    let digestSent = false
    let digestImageSent = false
    try {
      const report = await buildRadarDailyReport()
      if (report) {
        const delivery = await deliverReportCard({
          supabase: createAdminClient(),
          slug: 'radar-daily',
          runKey: report.runKey,
          card: report.card,
          caption: report.caption,
          text: report.text,
        })
        digestSent = delivery.textSent
        digestImageSent = delivery.imageSent
      }
    } catch (digestErr) {
      console.error('[Radar Cron] digest send failed:', digestErr)
    }

    return NextResponse.json({
      ...result,
      review_sync: reviewSync,
      digestSent,
      digestImageSent,
    })
  } catch (err) {
    console.error('[Radar Cron] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
