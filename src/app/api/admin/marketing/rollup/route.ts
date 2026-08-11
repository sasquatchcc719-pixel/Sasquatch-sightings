import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  coerceMarketingWeeklyRollupRow,
  refreshMarketingWeeklyRollup,
  weeksThroughCurrent,
} from '@/lib/ops/marketing-rollup'
import { createAdminClient } from '@/supabase/server'

export const maxDuration = 300

function requestedWeeks(request: NextRequest): number {
  return Math.min(
    Math.max(Number(request.nextUrl.searchParams.get('weeks') || 12), 1),
    52,
  )
}

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const weeks = requestedWeeks(request)
    const windows = weeksThroughCurrent(weeks)
    const town = request.nextUrl.searchParams.get('town')
    let query = createAdminClient()
      .from('marketing_weekly_rollup')
      .select('*')
      .gte('week_start', windows[windows.length - 1].start)
      .order('week_start', { ascending: false })
      .order('town_slug')
      .limit(1000)
    if (town) query = query.eq('town_slug', town)

    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []).map((row) =>
      coerceMarketingWeeklyRollupRow(row as Record<string, unknown>),
    )
    return NextResponse.json({
      ok: true,
      weeks,
      rows,
      builtAt: rows.reduce(
        (latest, row) => (row.built_at > latest ? row.built_at : latest),
        '',
      ),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Rollup load failed'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[marketing rollup GET]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const weeks = Math.min(requestedWeeks(request), 16)
    const result = await refreshMarketingWeeklyRollup(createAdminClient(), {
      windows: weeksThroughCurrent(weeks),
    })
    return NextResponse.json({
      ok: true,
      weeks,
      rows: result.rows.length,
      builtAt: result.builtAt,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Rollup refresh failed'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[marketing rollup POST]', error)
    return NextResponse.json({ error: message }, { status })
  }
}
