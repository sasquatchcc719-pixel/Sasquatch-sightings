import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadBusinessCostSnapshots } from '@/lib/ops/business-economics'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const [weeklySnapshots, yearToDateSnapshots] = await Promise.all([
      loadBusinessCostSnapshots(supabase, 'weekly'),
      loadBusinessCostSnapshots(supabase, 'year_to_date', 1),
    ])
    return NextResponse.json(
      {
        weeklySnapshots,
        yearToDate: yearToDateSnapshots.at(-1) || null,
        definition: {
          weeklyWindowDays: 7,
          annualWindow: 'January 1 through the latest completed Wednesday.',
          bookCost:
            'Cash-basis QuickBooks P&L costs, excluding reconciliation discrepancies.',
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[stats/business-economics]', error)
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load business cost history'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
