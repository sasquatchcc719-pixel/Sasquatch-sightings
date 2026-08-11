/**
 * QuickBooks Sync Cron
 * Reads pending sync jobs and pushes customers + invoices to QBO.
 * Runs every 15 minutes via Vercel Cron.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  createQBCustomer,
  createQBInvoice,
  queryRecentQBPayments,
  reconcileStaleQuickBooksInvoiceLink,
  syncBatchInvoiceToQuickBooks,
} from '@/lib/quickbooks-api'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'
import { sendTelegramNotification } from '@/lib/telegram'
import {
  formatSyncFailureAlert,
  isPermanentFailure,
  retryTimestamp,
  type SyncAlertContext,
} from '@/lib/ops/quickbooks-sync-retry'

const BATCH_SIZE = 20

type SyncJob = {
  id: string
  entity_type: 'customer' | 'invoice' | 'batch_invoice'
  entity_id: string
  payload: Record<string, unknown>
  sync_attempts?: number | null
}

type ExhaustedJob = {
  jobId: string
  entityType: string
  entityId: string
  attempts: number
  error: string
}

/**
 * Tell Charles once, on Telegram, when a job has run out of retries — the
 * whole point being that a stuck invoice can no longer sit unnoticed for
 * weeks. alerted_at guards against re-sending every 15 minutes.
 */
async function alertOnExhaustedJobs(
  supabase: ReturnType<typeof createAdminClient>,
  exhausted: ExhaustedJob[],
): Promise<void> {
  if (exhausted.length === 0) return

  const { data: unalerted } = await supabase
    .from('ops_quickbooks_sync_jobs')
    .select('id')
    .in(
      'id',
      exhausted.map((e) => e.jobId),
    )
    .is('alerted_at', null)

  const toAlert = new Set((unalerted ?? []).map((r) => r.id))
  const fresh = exhausted.filter((e) => toAlert.has(e.jobId))
  if (fresh.length === 0) return

  // Resolve a human reference (invoice #, customer name) so the alert says
  // which job is stuck rather than just a uuid.
  const contexts: SyncAlertContext[] = []
  for (const job of fresh) {
    let reference: string | null = null
    try {
      if (job.entityType === 'invoice') {
        const { data } = await supabase
          .from('ops_invoices')
          .select('invoice_number, total')
          .eq('id', job.entityId)
          .maybeSingle()
        if (data) reference = `#${data.invoice_number} ($${data.total})`
      } else if (job.entityType === 'customer') {
        const { data } = await supabase
          .from('ops_customers')
          .select('full_name, business_name')
          .eq('id', job.entityId)
          .maybeSingle()
        if (data) reference = data.business_name || data.full_name || null
      }
    } catch {
      // A missing label must never stop the alert going out.
    }
    contexts.push({
      entityType: job.entityType,
      reference,
      attempts: job.attempts,
      error: job.error,
    })
  }

  const sent = await sendTelegramNotification(formatSyncFailureAlert(contexts))
  if (sent) {
    await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ alerted_at: new Date().toISOString() })
      .in(
        'id',
        fresh.map((e) => e.jobId),
      )
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const qbStatus = await getQBConnectionStatus()
    if (!qbStatus.connected || !qbStatus.sync_enabled) {
      return NextResponse.json({
        processed: 0,
        synced: 0,
        failed: 0,
        skipped: 'sync disabled or not connected',
      })
    }

    const supabase = createAdminClient()

    // Auto-promote held rows now that we've confirmed QB is connected and enabled.
    // Rows are created as 'held' when the QUICKBOOKS_SYNC_ENABLED env var was false
    // at booking time. This ensures they get picked up on the next cron run.
    const { data: promotedRows } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'held')
      .select('id')

    const promotedCount = promotedRows?.length ?? 0

    if (promotedCount && promotedCount > 0) {
      console.log(
        `[cron/quickbooks-sync] Promoted ${promotedCount} held rows to pending`,
      )
    }

    // Only pick up work that is actually due — a job waiting out its backoff
    // carries a future next_retry_at and must be left alone until then.
    const dueFilter = `next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`

    // Fetch customer jobs first — invoices depend on customers being synced
    const { data: customerJobs, error: customerJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload, sync_attempts')
      .eq('status', 'pending')
      .eq('entity_type', 'customer')
      .or(dueFilter)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (customerJobsError) throw customerJobsError

    const { data: invoiceJobs, error: invoiceJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload, sync_attempts')
      .eq('status', 'pending')
      .eq('entity_type', 'invoice')
      .or(dueFilter)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (invoiceJobsError) throw invoiceJobsError

    const { data: batchInvoiceJobs, error: batchJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload, sync_attempts')
      .eq('status', 'pending')
      .eq('entity_type', 'batch_invoice')
      .or(dueFilter)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (batchJobsError) throw batchJobsError

    const jobs = [
      ...(customerJobs || []),
      ...(invoiceJobs || []),
      ...(batchInvoiceJobs || []),
    ]

    if (jobs.length === 0) {
      return NextResponse.json({ processed: 0, synced: 0, failed: 0 })
    }

    const results = {
      processed: jobs.length,
      synced: 0,
      failed: 0,
      retrying: 0,
      errors: [] as string[],
    }
    const exhausted: ExhaustedJob[] = []

    for (const job of jobs as SyncJob[]) {
      const attemptCount = Number(job.sync_attempts || 0) + 1
      await supabase
        .from('ops_quickbooks_sync_jobs')
        .update({
          sync_attempts: attemptCount,
          last_attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      try {
        if (job.entity_type === 'customer') {
          const payload = job.payload as {
            customer_id: string
            display_name: string
            email: string | null
            phone: string
            billing_address: {
              line1: string
              line2?: string | null
              city: string
              country_sub_division_code: string
              postal_code: string
            }
          }

          // Already linked to QuickBooks — don't attempt a create that QBO will
          // reject as a duplicate name. Settle the row instead of burning the
          // retry ladder on a job that can never succeed.
          const { data: existingCustomer } = await supabase
            .from('ops_customers')
            .select('quickbooks_customer_id')
            .eq('id', payload.customer_id)
            .maybeSingle()

          if (existingCustomer?.quickbooks_customer_id) {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'synced',
                error_message: null,
                alerted_at: null,
                next_retry_at: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            results.synced++
            continue
          }

          const qbCustomerId = await createQBCustomer({
            customerId: payload.customer_id,
            displayName: payload.display_name,
            email: payload.email,
            phone: payload.phone,
            address: {
              street_1: payload.billing_address.line1,
              street_2: payload.billing_address.line2,
              city: payload.billing_address.city,
              state: payload.billing_address.country_sub_division_code,
              zip_code: payload.billing_address.postal_code,
            },
          })

          // Save QB customer ID back to ops_customers
          await supabase
            .from('ops_customers')
            .update({ quickbooks_customer_id: qbCustomerId })
            .eq('id', payload.customer_id)
        } else if (job.entity_type === 'invoice') {
          // Always load current line items and totals from the DB — the queued
          // payload can be stale if the job was created at booking time.
          const invoiceId = job.entity_id

          const { data: invRow, error: invErr } = await supabase
            .from('ops_invoices')
            .select(
              `
              id,
              status,
              payment_method,
              discount_amount,
              percentage_discount_amount,
              invoice_number,
              quickbooks_invoice_id,
              appointment_id,
              ops_invoice_line_items ( description, quantity, unit_price, line_total ),
              ops_appointments!inner ( appointment_date, customer_id )
            `,
            )
            .eq('id', invoiceId)
            .single()

          if (invErr || !invRow) {
            throw new Error(`Invoice ${invoiceId} not found`)
          }

          if (invRow.payment_method === 'cash') {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'synced',
                error_message: 'skipped: cash payment (not sent to QuickBooks)',
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            await supabase
              .from('ops_invoices')
              .update({
                sync_status: 'held',
                updated_at: new Date().toISOString(),
              })
              .eq('id', invoiceId)
            results.synced++
            continue
          }

          if (invRow.status === 'draft') {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'held',
                error_message:
                  'deferred: invoice still draft (syncs when job completes)',
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            continue
          }

          let qbLinkedId = invRow.quickbooks_invoice_id
          if (qbLinkedId) {
            const cleared = await reconcileStaleQuickBooksInvoiceLink(
              supabase,
              invRow.id,
              qbLinkedId,
            )
            if (cleared) qbLinkedId = null
          }

          if (qbLinkedId) {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'synced',
                error_message: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            results.synced++
            continue
          }

          const appt = Array.isArray(invRow.ops_appointments)
            ? invRow.ops_appointments[0]
            : invRow.ops_appointments

          const { data: custRow } = await supabase
            .from('ops_customers')
            .select('quickbooks_customer_id')
            .eq('id', appt.customer_id)
            .maybeSingle()

          if (!custRow?.quickbooks_customer_id) {
            throw new Error(`Customer ${appt.customer_id} not yet synced to QB`)
          }

          const lineItems = Array.isArray(invRow.ops_invoice_line_items)
            ? invRow.ops_invoice_line_items.map((line) => ({
                ...line,
                product_name: line.description,
              }))
            : []

          const qbInvoiceId = await createQBInvoice({
            qbCustomerId: custRow.quickbooks_customer_id,
            serviceDate: appt.appointment_date,
            lineItems,
            discountAmount:
              Number(invRow.discount_amount || 0) +
              Number(invRow.percentage_discount_amount || 0),
            docNumber:
              (invRow as { invoice_number?: number | string | null })
                .invoice_number ?? null,
          })

          await supabase
            .from('ops_invoices')
            .update({
              quickbooks_invoice_id: qbInvoiceId,
              sync_status: 'synced',
              last_synced_at: new Date().toISOString(),
            })
            .eq('id', invoiceId)
        } else if (job.entity_type === 'batch_invoice') {
          const payload = job.payload as {
            invoice_id: string
          }

          const { data: batchRow } = await supabase
            .from('ops_batch_invoices')
            .select('quickbooks_invoice_id')
            .eq('id', payload.invoice_id)
            .maybeSingle()

          if (batchRow?.quickbooks_invoice_id) {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'synced',
                error_message: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            results.synced++
            continue
          }

          await syncBatchInvoiceToQuickBooks(payload.invoice_id)
        }

        // Mark job synced
        await supabase
          .from('ops_quickbooks_sync_jobs')
          .update({
            status: 'synced',
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)

        results.synced++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        results.failed++
        results.errors.push(`${job.id}: ${message}`)

        // A bad request will fail identically forever, so don't burn the
        // ladder on it — go terminal now and alert. Everything else gets
        // another go after a backoff.
        const retryAt = isPermanentFailure(message)
          ? null
          : retryTimestamp(attemptCount)

        if (retryAt) {
          await supabase
            .from('ops_quickbooks_sync_jobs')
            .update({
              status: 'pending',
              error_message: message,
              next_retry_at: retryAt,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
          results.retrying++
        } else {
          await supabase
            .from('ops_quickbooks_sync_jobs')
            .update({
              status: 'failed',
              error_message: message,
              next_retry_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', job.id)
          exhausted.push({
            jobId: job.id,
            entityType: job.entity_type,
            entityId: job.entity_id,
            attempts: attemptCount,
            error: message,
          })
        }
      }
    }

    await alertOnExhaustedJobs(supabase, exhausted)

    // --- Payment polling: sync QB payments back to local invoices ---
    let paymentsUpdated = 0
    try {
      const sinceDate = new Date(Date.now() - 25 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 19)

      const qbPayments = await queryRecentQBPayments(sinceDate)

      for (const payment of qbPayments) {
        for (const line of payment.Line || []) {
          for (const txn of line.LinkedTxn || []) {
            if (txn.TxnType !== 'Invoice') continue

            const qbInvoiceId = txn.TxnId

            const { data: localInvoice } = await supabase
              .from('ops_invoices')
              .select('id, status')
              .eq('quickbooks_invoice_id', qbInvoiceId)
              .maybeSingle()

            if (localInvoice && localInvoice.status !== 'paid') {
              await supabase
                .from('ops_invoices')
                .update({
                  status: 'paid',
                  payment_method: 'quickbooks',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', localInvoice.id)
              paymentsUpdated++
            }

            // Also check batch invoices
            if (!localInvoice) {
              const { data: batchInvoice } = await supabase
                .from('ops_batch_invoices')
                .select('id, status')
                .eq('quickbooks_invoice_id', qbInvoiceId)
                .maybeSingle()

              if (batchInvoice && batchInvoice.status !== 'paid') {
                await supabase
                  .from('ops_batch_invoices')
                  .update({
                    status: 'paid',
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', batchInvoice.id)
                paymentsUpdated++
              }
            }
          }
        }
      }
    } catch (paymentErr) {
      console.error('[cron/quickbooks-sync] Payment polling error:', paymentErr)
    }

    console.log('[cron/quickbooks-sync]', { ...results, paymentsUpdated })
    return NextResponse.json({ ...results, paymentsUpdated })
  } catch (error) {
    console.error('[cron/quickbooks-sync] Fatal error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
