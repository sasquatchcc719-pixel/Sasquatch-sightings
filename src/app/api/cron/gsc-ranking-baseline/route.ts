/**
 * Cron: weekly GSC ranking-baseline snapshot (Mondays, after gsc-watch).
 * Stores site-wide totals + watchlist keyword positions, then sends a short
 * admin push with the summary card attached. The full page lives on
 * Comms → Telegram; this is not important enough for the owner Telegram chat.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { runGscRankingBaseline } from '@/lib/gsc-ranking-baseline'

export const maxDuration = 120

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
    // SEO Telegram delivery is retired; preserve the logged error and HTTP status.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
