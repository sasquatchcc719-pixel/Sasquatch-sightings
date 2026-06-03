import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { createAdminClient } from '@/supabase/server'

/**
 * POST /api/admin/quickbooks/retry
 * Resets all failed QB sync jobs back to 'pending' so the cron picks them up again.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const supabase = createAdminClient()
    const body = await request.json().catch(() => ({}))
    const invoiceId = String(body.invoice_id || '').trim()

    const now = new Date().toISOString()

    if (invoiceId) {
      const { data: invoice, error: invoiceError } = await supabase
        .from('ops_invoices')
        .select('id, appointment_id')
        .eq('id', invoiceId)
        .maybeSingle()

      if (invoiceError) throw invoiceError
      if (!invoice?.appointment_id) {
        return NextResponse.json(
          { error: 'Invoice not found or missing appointment' },
          { status: 404 },
        )
      }

      const queued = await ensureInvoiceQuickBooksSyncJob(supabase, invoiceId)

      if (!queued.queued) {
        return NextResponse.json({
          invoice_id: invoiceId,
          queued: false,
          reason: queued.reason,
        })
      }

      await syncAppointmentToQuickBooks(invoice.appointment_id)

      return NextResponse.json({
        invoice_id: invoiceId,
        queued: true,
        status: queued.status,
      })
    }

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
