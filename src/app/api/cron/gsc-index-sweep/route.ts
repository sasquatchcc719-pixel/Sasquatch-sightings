/**
 * Cron: Thursday Google index check.
 * Inspects sitemap pages, stores the results, and sends Charles a concise
 * progress digest. This route never requests a crawl or indexing action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runGscIndexCheck } from '@/lib/gsc-index-sweep'
import { sendTelegramNotification } from '@/lib/telegram'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runGscIndexCheck(createAdminClient())
    return NextResponse.json({
      success: true,
      inspected: result.inspected,
      indexed: result.indexed,
      waiting: result.waiting,
      other: result.other,
      unavailable: result.unavailable,
      newlyIndexed: result.newlyIndexed.length,
      droppedFromIndex: result.droppedFromIndex.length,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Index check failed'
    console.error('[cron/gsc-index-check] Error:', error)
    await sendTelegramNotification(
      `⚠️ Thursday Google Index Check could not run.\n` +
        `Error: ${message}\n` +
        `Check the Search Console connection in Vercel.`,
    ).catch((notifyErr) =>
      console.error(
        '[cron/gsc-index-check] failure-alert send failed:',
        notifyErr,
      ),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
