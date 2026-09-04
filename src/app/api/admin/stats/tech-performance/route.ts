import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  loadOwnerPerformance,
  loadTechPerformance,
} from '@/lib/ops/tech-performance'

/**
 * Per-tech profitability: completed-job revenue and hours vs timesheet paid
 * hours and gross wages, grouped by day and month. Owner/admin only — wage data.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const [techs, owner] = await Promise.all([
      loadTechPerformance(supabase),
      loadOwnerPerformance(supabase, { hourlyRate: 25 }),
    ])
    return NextResponse.json({ techs, owner })
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
