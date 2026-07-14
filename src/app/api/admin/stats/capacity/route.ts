import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadScheduleCapacity } from '@/lib/ops/capacity'

/**
 * Schedule-based available hours for the stats page. Capacity comes from the
 * live tech schedule (availability templates + per-day staff toggles), so the
 * numbers track real staffing instead of a flat hours-per-week setting.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech', 'marketing'])
    const supabase = createAdminClient()

    const capacity = await loadScheduleCapacity(supabase)
    if (!capacity) {
      return NextResponse.json({ capacity: null })
    }

    return NextResponse.json({ capacity })
  } catch (err) {
    console.error('[stats/capacity]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load capacity'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
