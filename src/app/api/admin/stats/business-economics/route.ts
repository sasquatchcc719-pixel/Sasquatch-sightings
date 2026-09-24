import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { loadBusinessCostSnapshots } from '@/lib/ops/business-economics'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const snapshots = await loadBusinessCostSnapshots(createAdminClient())
    return NextResponse.json(
      {
        snapshots,
        definition: {
          windowDays: 28,
          bookCost:
            'Cash-basis QuickBooks P&L costs, excluding reconciliation discrepancies.',
          ownerAdjustedCost:
            'Book cost plus recorded owner field hours at $31/hour.',
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
