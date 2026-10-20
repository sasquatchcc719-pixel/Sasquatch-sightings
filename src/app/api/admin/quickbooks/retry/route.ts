import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import { createAdminClient } from '@/supabase/server'
import {
  getQBConnectionStatus,
  QB_RECONNECT_MESSAGE,
  QuickBooksTokenError,
} from '@/lib/quickbooks-auth'
import { isPermanentFailure } from '@/lib/ops/quickbooks-sync-retry'

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
    const action = String(body.action || 'retry').trim()

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

      if (action === 'clear') {
        const { error: invoiceUpdateError } = await supabase
          .from('ops_invoices')
          .update({ sync_status: 'held', updated_at: now })
          .eq('id', invoiceId)

        if (invoiceUpdateError) throw invoiceUpdateError

        const { error: jobDeleteError } = await supabase
          .from('ops_quickbooks_sync_jobs')
          .delete()
          .eq('entity_type', 'invoice')
          .eq('entity_id', invoiceId)

        if (jobDeleteError) throw jobDeleteError

        return NextResponse.json({
          invoice_id: invoiceId,
          cleared: true,
        })
      }

      const connection = await getQBConnectionStatus()
      if (connection.reconnect_required) {
        return NextResponse.json(
          { error: QB_RECONNECT_MESSAGE, reconnect_required: true },
          { status: 409 },
        )
      }
      if (!connection.connected || !connection.sync_enabled) {
        return NextResponse.json(
          { error: 'Connect QuickBooks and enable auto-sync before retrying.' },
          { status: 409 },
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

      try {
        await syncAppointmentToQuickBooks(invoice.appointment_id)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'QuickBooks sync failed'
        if (isPermanentFailure(message)) {
          return NextResponse.json(
            {
              error: message,
              reconnect_required:
                error instanceof QuickBooksTokenError &&
                error.code === 'invalid_grant',
            },
            { status: 409 },
          )
        }
        return NextResponse.json(
          {
            invoice_id: invoiceId,
            queued: true,
            status: 'pending',
            message:
              'QuickBooks is temporarily unavailable. This invoice remains queued and will retry automatically.',
          },
          { status: 202 },
        )
      }

      const { data: confirmed, error: confirmError } = await supabase
        .from('ops_invoices')
        .select('quickbooks_invoice_id, sync_status, status, payment_method')
        .eq('id', invoiceId)
        .maybeSingle()
      if (confirmError) throw confirmError
      if (
        !confirmed?.quickbooks_invoice_id ||
        confirmed.sync_status !== 'synced'
      ) {
        const skipped =
          confirmed?.payment_method === 'cash' || confirmed?.status === 'draft'
        return NextResponse.json(
          {
            invoice_id: invoiceId,
            queued: !skipped,
            status: skipped ? 'held' : 'pending',
            message: skipped
              ? 'Invoice was not sent because it is now cash-paid or draft.'
              : 'QuickBooks sync is not confirmed yet. The invoice remains queued for automatic retry.',
          },
          { status: 202 },
        )
      }

      return NextResponse.json({
        invoice_id: invoiceId,
        queued: true,
        status: 'synced',
      })
    }

    const connection = await getQBConnectionStatus()
    if (connection.reconnect_required) {
      return NextResponse.json(
        { error: QB_RECONNECT_MESSAGE, reconnect_required: true },
        { status: 409 },
      )
    }
    if (!connection.connected || !connection.sync_enabled) {
      return NextResponse.json(
        { error: 'Connect QuickBooks and enable auto-sync before retrying.' },
        { status: 409 },
      )
    }

    // Promote failed jobs back to pending. Reset the retry ladder too —
    // a manual retry means "try this properly again", so clear the attempt
    // count, make it due immediately, and re-arm the alert.
    const { data: failedData, error: failedError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({
        status: 'pending',
        error_message: null,
        sync_attempts: 0,
        next_retry_at: null,
        alerted_at: null,
        updated_at: now,
      })
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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retry jobs',
      },
      { status: 500 },
    )
  }
}
