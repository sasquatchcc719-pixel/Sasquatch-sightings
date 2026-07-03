/**
 * Cron: weekly GSC ranking-baseline snapshot (Mondays, after gsc-watch).
 * Stores site-wide totals + watchlist keyword positions, diffs vs last week
 * and vs ~28 days ago, and sends Charles a Telegram digest so ranking
 * progress (not just index coverage) is visible week to week and month to
 * month.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { runGscRankingBaseline } from '@/lib/gsc-ranking-baseline'
import { sendTelegramNotification } from '@/lib/telegram'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const result = await runGscRankingBaseline(supabase)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'GSC ranking baseline failed'
    console.error('[cron/gsc-ranking-baseline] Error:', error)
    await sendTelegramNotification(
      `🚨 GSC Ranking Baseline FAILED — no trend report this week.\n` +
        `Error: ${message}\n` +
        `Likely cause: expired Google OAuth token. Re-mint with ` +
        `\`node scripts/gsc-auth.mjs url\` then update ` +
        `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN in Vercel.`,
    ).catch((notifyErr) =>
      console.error(
        '[cron/gsc-ranking-baseline] failure-alert send failed:',
        notifyErr,
      ),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
