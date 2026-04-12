import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * POST /api/admin/quickbooks/retry
 * Resets all failed QB sync jobs back to 'pending' so the cron picks them up again.
 */
export async function POST() {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()

    const now = new Date().toISOString()

    // Promote failed jobs back to pending
    const { data: failedData, error: failedError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ status: 'pending', error_message: null, updated_at: now })
      .eq('status', 'failed')
      .select('id')

    if (failedError) throw failedError

    // Also promote any held jobs (were stuck due to env var bug)
    const { data: heldData, error: heldError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ status: 'pending', updated_at: now })
      .eq('status', 'held')
      .select('id')

    if (heldError) throw heldError

    return NextResponse.json({
      retried: failedData?.length ?? 0,
      promoted_from_held: heldData?.length ?? 0,
    })
  } catch (error) {
    console.error('[admin/quickbooks/retry] Error:', error)
    return NextResponse.json({ error: 'Failed to retry jobs' }, { status: 500 })
  }
}
