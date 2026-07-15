import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadBusinessHealth } from '@/lib/ops/business-health'

/**
 * Retention, recurring-base, and booked-out metrics for /admin/stats.
 */
export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const health = await loadBusinessHealth(supabase)
    return NextResponse.json(health)
  } catch (err) {
    console.error('[stats/business-health]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load business health'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
