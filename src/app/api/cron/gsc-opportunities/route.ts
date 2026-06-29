/**
 * Cron: monthly Google Search Console "page-2 opportunity" report.
 * Finds keywords ranking just off page 1, reads the live page, asks OpenAI what
 * content gaps to fill, and sends Charles a Telegram digest as a monthly nudge
 * to review. Never edits the site — recommendations only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runGscOpportunities } from '@/lib/gsc-opportunities'
import { sendTelegramNotification } from '@/lib/telegram'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runGscOpportunities()
    return NextResponse.json({
      success: true,
      analyzed: result.analyzed,
      opportunities: result.opportunities.map((o) => ({
        keyword: o.keyword,
        page: o.page,
        position: o.position,
        impressions: o.impressions,
        clicks: o.clicks,
        recommendation: o.recommendation ?? null,
      })),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'GSC opportunities failed'
    console.error('[cron/gsc-opportunities] Error:', error)
    // The monthly digest only sends on success, so surface failures (e.g. dead
    // Google OAuth token) instead of letting the report quietly vanish.
    await sendTelegramNotification(
      `🚨 Monthly SEO Opportunity report FAILED — no report this month.\n` +
        `Error: ${message}\n` +
        `Likely cause: expired Google OAuth token. Re-mint with ` +
        `\`node scripts/gsc-auth.mjs url\` then update ` +
        `GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN in Vercel.`,
    ).catch((notifyErr) =>
      console.error(
        '[cron/gsc-opportunities] failure-alert send failed:',
        notifyErr,
      ),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
