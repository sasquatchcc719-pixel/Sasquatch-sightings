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
} from '@/lib/quickbooks-api'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'

const BATCH_SIZE = 20

type SyncJob = {
  id: string
  entity_type: 'customer' | 'invoice' | 'batch_invoice'
  entity_id: string
  payload: Record<string, unknown>
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

    // Fetch customer jobs first — invoices depend on customers being synced
    const { data: customerJobs, error: customerJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload')
      .eq('status', 'pending')
      .eq('entity_type', 'customer')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (customerJobsError) throw customerJobsError

    const { data: invoiceJobs, error: invoiceJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload')
      .eq('status', 'pending')
      .eq('entity_type', 'invoice')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (invoiceJobsError) throw invoiceJobsError

    const { data: batchInvoiceJobs, error: batchJobsError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .select('id, entity_type, entity_id, payload')
      .eq('status', 'pending')
      .eq('entity_type', 'batch_invoice')
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
      errors: [] as string[],
    }

    for (const job of jobs as SyncJob[]) {
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
            results.synced++
            continue
          }

          if (invRow.status === 'draft') {
            await supabase
              .from('ops_quickbooks_sync_jobs')
              .update({
                status: 'synced',
                error_message:
                  'skipped: invoice still draft (syncs when job completes)',
                updated_at: new Date().toISOString(),
              })
              .eq('id', job.id)
            results.synced++
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
            ? invRow.ops_invoice_line_items
            : []

          const qbInvoiceId = await createQBInvoice({
            qbCustomerId: custRow.quickbooks_customer_id,
            serviceDate: appt.appointment_date,
            lineItems,
            discountAmount: Number(invRow.discount_amount || 0),
            docNumber:
              (invRow as { invoice_number?: number | string | null })
                .invoice_number ?? null,
          })

          await supabase
            .from('ops_invoices')
            .update({
              quickbooks_invoice_id: qbInvoiceId,
              sync_status: 'synced',
            })
            .eq('id', invoiceId)
        } else if (job.entity_type === 'batch_invoice') {
          const payload = job.payload as {
            invoice_id: string
            customer_id: string
            service_date: string
            subtotal: number
            total: number
            lines: Array<{
              description: string
              quantity: number
              unit_price: number
              line_total: number
            }>
          }

          const { data: customer } = await supabase
            .from('ops_customers')
            .select('quickbooks_customer_id')
            .eq('id', payload.customer_id)
            .maybeSingle()

          if (!customer?.quickbooks_customer_id) {
            throw new Error(
              `Customer ${payload.customer_id} not yet synced to QB`,
            )
          }

          const { data: batchRow } = await supabase
            .from('ops_batch_invoices')
            .select('invoice_number')
            .eq('id', payload.invoice_id)
            .maybeSingle()

          const qbInvoiceId = await createQBInvoice({
            qbCustomerId: customer.quickbooks_customer_id,
            serviceDate: payload.service_date,
            lineItems: payload.lines,
            docNumber:
              (batchRow as { invoice_number?: number | string | null } | null)
                ?.invoice_number ?? null,
          })

          await supabase
            .from('ops_batch_invoices')
            .update({
              quickbooks_invoice_id: qbInvoiceId,
              sync_status: 'synced',
              status: 'sent',
              updated_at: new Date().toISOString(),
            })
            .eq('id', payload.invoice_id)
        }

        // Mark job synced
        await supabase
          .from('ops_quickbooks_sync_jobs')
          .update({ status: 'synced', updated_at: new Date().toISOString() })
          .eq('id', job.id)

        results.synced++
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        results.failed++
        results.errors.push(`${job.id}: ${message}`)

        await supabase
          .from('ops_quickbooks_sync_jobs')
          .update({
            status: 'failed',
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
      }
    }

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
