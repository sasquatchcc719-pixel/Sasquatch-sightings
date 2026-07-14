import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadUtilizationSupplementRows } from '@/lib/ops/utilization-supplement'

/**
 * Completed ops jobs whose revenue/hours are not already represented by
 * revenue_entries (stats-only) or published jobs rows — so utilization matches Operations.
 */
export async function GET() {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
      'marketing',
    ])
    const supabase = createAdminClient()

    const rows = await loadUtilizationSupplementRows(supabase, {
      coverageUserId: access.id,
    })

    return NextResponse.json({ rows })
  } catch (err) {
    console.error('[utilization-supplement]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load supplement'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
