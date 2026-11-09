import { NextRequest, NextResponse } from 'next/server'
import {
  completedWeeks,
  refreshMarketingWeeklyRollup,
} from '@/lib/ops/marketing-rollup'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Rebuild two completed weeks: last week may have only Mon-Fri GSC data on
    // its first Monday, then receives its complete weekend on the next run.
    const windows = completedWeeks(2)
    const result = await refreshMarketingWeeklyRollup(createAdminClient(), {
      windows,
    })
    const reportRows = result.rows.filter(
      (row) => row.week_start === windows[0].start,
    )
    // Retain the weekly data for the dashboard without pushing the briefing.
    // Other Telegram reports and operational notifications are independent.
    return NextResponse.json({
      ok: true,
      weekStart: windows[0].start,
      rows: reportRows.length,
      builtAt: result.builtAt,
      briefingTelegramEnabled: false,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Marketing weekly rollup failed'
    console.error('[cron/marketing-weekly-rollup]', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
