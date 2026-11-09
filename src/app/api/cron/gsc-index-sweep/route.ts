/**
 * Cron: Thursday Google index check.
 * Inspects sitemap pages and stores the results without Telegram delivery. This route never requests a crawl or indexing action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runGscIndexCheck } from '@/lib/gsc-index-sweep'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    // SEO Telegram delivery is retired; preserve the logged error and HTTP status.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
