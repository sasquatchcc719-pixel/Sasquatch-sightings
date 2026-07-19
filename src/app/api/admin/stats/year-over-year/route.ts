import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadYearOverYear } from '@/lib/ops/year-over-year'

/**
 * Multi-year revenue history from imported QuickBooks invoices.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const history = await loadYearOverYear(supabase)
    return NextResponse.json({ history })
  } catch (err) {
    console.error('[stats/year-over-year]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load history'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
