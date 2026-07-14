import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadTechPerformance } from '@/lib/ops/tech-performance'

/**
 * Per-tech profitability: completed-job revenue and hours vs timesheet paid
 * hours and gross wages, grouped by month. Owner/admin only — wage data.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const techs = await loadTechPerformance(supabase)
    return NextResponse.json({ techs })
  } catch (err) {
    console.error('[stats/tech-performance]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load tech performance'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
