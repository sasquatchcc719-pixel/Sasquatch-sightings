/**
 * Cron: weekly Google Search Console watch (Mondays).
 * Inspects key pages, snapshots coverage, diffs vs last week, resubmits stale
 * sitemaps when permitted, and sends Charles a Telegram digest.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { runGscWatch } from '@/lib/gsc-watch'

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
    console.error('[cron/gsc-watch] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'GSC watch failed' },
      { status: 500 },
    )
  }
}
