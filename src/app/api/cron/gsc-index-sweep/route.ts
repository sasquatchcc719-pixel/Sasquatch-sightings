/**
 * Cron: weekly GSC Index Sweep.
 * Inspects sitemap pages, fires Google Indexing API pings at the ones that
 * aren't indexed (crawl-budget starved), and sends Charles a progress digest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runGscIndexSweep } from '@/lib/gsc-index-sweep'
import { sendTelegramNotification } from '@/lib/telegram'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runGscIndexSweep()
    return NextResponse.json({
      success: true,
      inspected: result.inspected,
      indexed: result.indexed,
      notIndexed: result.notIndexed,
      pinged: result.pinged.length,
      pingFailed: result.pingFailed,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Index sweep failed'
    console.error('[cron/gsc-index-sweep] Error:', error)
    await sendTelegramNotification(
      `🚨 GSC Index Sweep FAILED — no force-crawl run this week.\n` +
        `Error: ${message}\n` +
        `Check GOOGLE_INDEXING_SA_JSON / GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN in Vercel.`,
    ).catch((notifyErr) =>
      console.error(
        '[cron/gsc-index-sweep] failure-alert send failed:',
        notifyErr,
      ),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
