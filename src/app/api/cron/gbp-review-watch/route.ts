/**
 * Daily Google Business Profile review watchdog.
 *
 * Logs the displayed review count, pulls the full corpus, and alerts on Telegram
 * the day a review disappears. Costs ~$0.02/run.
 *
 * Runs daily rather than hourly on purpose: Google's counter flaps within a day
 * (observed 80 → 81 → 80 on 2026-08-11), and an hourly job would alert on noise.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { syncGbpReviews } from '@/lib/ops/gbp-review-sync'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
    return NextResponse.json({ ok: true, skipped: 'no DataForSEO credentials' })
  }

  try {
    const result = await syncGbpReviews(createAdminClient())
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
