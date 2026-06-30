import { NextResponse } from 'next/server'
import { requireClientManager } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { loadClientPortalData } from '@/lib/ops/client-portal'

/**
 * GET /api/client/overview
 * Returns the authenticated client_manager's scoped schedule, intervals, and requests.
 */
export async function GET() {
  try {
    const { client } = await requireClientManager()
    const supabase = createAdminClient()
    const data = await loadClientPortalData(supabase, client.customer_id)
    return NextResponse.json(data)
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Not a client manager'
        ? 403
        : 500
    return NextResponse.json({ error: 'Failed to load portal' }, { status })
  }
}
