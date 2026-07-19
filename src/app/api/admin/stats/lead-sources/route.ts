import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadAttributedLeadSources } from '@/lib/ops/attribution'

/**
 * GET /api/admin/stats/lead-sources
 *
 * Lead-source breakdown from the single attribution engine
 * (src/lib/ops/attribution.ts): first-touch model, canonical keys, repeat and
 * recurring revenue credited to the acquisition channel, unattributed revenue
 * kept visible. Replaces the old RPC + raw-text fallback, which grouped by
 * different fields depending on which path ran.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start_date') || '2020-01-01'
    const endDate = searchParams.get('end_date') || '2099-12-31'

    const summary = await loadAttributedLeadSources(supabase, {
      startDate,
      endDate,
    })

    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof Error && error.message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[stats/lead-sources] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load lead source stats' },
      { status: 500 },
    )
  }
}
