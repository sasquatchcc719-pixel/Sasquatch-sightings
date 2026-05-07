import { NextResponse } from 'next/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'
import { createAdminClient } from '@/supabase/server'

export async function GET() {
  try {
    const { user, role } = await getUserWithRole()
    if (!user || !hasRoleAccess(role, ['admin', 'owner'])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()
    const connectionStatus = await getQBConnectionStatus()

    const [
      pendingResult,
      failedResult,
      syncedResult,
      eligibleInvoicesResult,
      pendingInvoiceJobsResult,
    ] = await Promise.all([
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
      supabase
        .from('ops_invoices')
        .select(
          `
          id,
          payment_method,
          status,
          ops_appointments!inner ( status, kind )
        `,
        )
        .is('quickbooks_invoice_id', null)
        .in('status', ['ready', 'sent', 'paid']),
      supabase
        .from('ops_quickbooks_sync_jobs')
        .select('entity_id')
        .eq('entity_type', 'invoice')
        .eq('status', 'pending'),
    ])

    const pendingInvoiceIds = new Set(
      (pendingInvoiceJobsResult.data || []).map((row) => row.entity_id),
    )
    const stuckInvoices = (eligibleInvoicesResult.data || []).filter((row) => {
      const appointment = Array.isArray(row.ops_appointments)
        ? row.ops_appointments[0]
        : row.ops_appointments
      return (
        appointment?.kind !== 'estimate' &&
        (appointment?.status === 'completed' || row.status === 'paid') &&
        row.payment_method !== 'cash' &&
        !pendingInvoiceIds.has(row.id)
      )
    })

    return NextResponse.json(
      {
        ...connectionStatus,
        pending: pendingResult.count || 0,
        failed: failedResult.count || 0,
        stuck: stuckInvoices.length,
        last_synced_at: syncedResult.data?.updated_at || null,
      },
      {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      },
    )
  } catch (error) {
    console.error('[quickbooks/status] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
