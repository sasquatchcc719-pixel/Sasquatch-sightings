import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import {
  buildMarketingRollupDigest,
  coerceMarketingWeeklyRollupRow,
  completedWeeks,
} from '@/lib/ops/marketing-rollup'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const week = completedWeeks(1)[0]
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('marketing_weekly_rollup')
      .select('*')
      .eq('week_start', week.start)
    if (error) throw error
    const rows = (data ?? []).map((row) =>
      coerceMarketingWeeklyRollupRow(row as Record<string, unknown>),
    )
    return NextResponse.json({
      weekStart: week.start,
      weekEnd: week.end,
      digest: rows.length ? buildMarketingRollupDigest(rows) : null,
    })
  } catch (err) {
    console.error('[admin/comms/telegram/briefing]', err)
    return NextResponse.json(
      { error: 'Failed to load briefing' },
      { status: 500 },
    )
  }
}
