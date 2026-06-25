/**
 * Cron: weekly Google Search Console watch (Mondays).
 * Inspects key pages, snapshots coverage, diffs vs last week, resubmits stale
 * sitemaps when permitted, and sends Charles a Telegram digest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { runGscWatch } from '@/lib/gsc-watch'
import { sendTelegramNotification } from '@/lib/telegram'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const result = await runGscWatch(supabase)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GSC watch failed'
    console.error('[cron/gsc-watch] Error:', error)
    // The weekly digest only sends on success, so a thrown error (e.g. a dead
    // Google OAuth refresh token) would otherwise vanish silently. Alert Charles
    // so the job can never quietly die again. Never let the alert mask the error.
    await sendTelegramNotification(
      `🚨 GSC Weekly Watch FAILED — no index report this week.\n` +
        `Error: ${message}\n` +
        `Likely cause: expired Google OAuth token. Re-mint with ` +
        `\`node scripts/gsc-auth.mjs url\` then update ` +
        `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN in Vercel.`,
    ).catch((notifyErr) =>
      console.error('[cron/gsc-watch] failure-alert send failed:', notifyErr),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
