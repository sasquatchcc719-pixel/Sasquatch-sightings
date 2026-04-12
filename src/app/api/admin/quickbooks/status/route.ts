import { NextResponse } from 'next/server'
import { getUserWithRole } from '@/lib/auth'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const connectionStatus = await getQBConnectionStatus()

    const [pendingResult, failedResult, syncedResult] = await Promise.all([
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('updated_at')
        .eq('status', 'synced')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    return NextResponse.json({
      ...connectionStatus,
      pending: pendingResult.count || 0,
      failed: failedResult.count || 0,
      last_synced_at: syncedResult.data?.updated_at || null,
    })
  } catch (error) {
    console.error('[quickbooks/status] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
