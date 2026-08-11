import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { createAdminClient } from '@/supabase/server'

type AdminClient = ReturnType<typeof createAdminClient>

type CustomerPayload = ReturnType<typeof buildQuickBooksCustomerPayload>

type EnsureCustomerSyncJobResult =
  | { ok: true; queued: true; status: 'pending' | 'held' | 'synced' | 'failed' }
  | { ok: true; queued: false; reason: string }

/**
 * Queue a customer for QuickBooks only when they aren't in QuickBooks already.
 *
 * Every booking path used to insert a row here unconditionally, so customers
 * that already had a `quickbooks_customer_id` got re-queued on every booking
 * and every recurring generation. Those rows can never succeed — QuickBooks
 * rejects the create with "Duplicate Name Exists" — so they pile up as failures
 * forever. Booking a job is not a reason to re-push a customer we already have.
 */
export async function ensureCustomerQuickBooksSyncJob(
  supabase: AdminClient,
  customerId: string,
  payload: CustomerPayload,
): Promise<EnsureCustomerSyncJobResult> {
  const { data: customer, error } = await supabase
    .from('ops_customers')
    .select('id, quickbooks_customer_id')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!customer) return { ok: true, queued: false, reason: 'customer not found' }

  const now = new Date().toISOString()

  // Already in QuickBooks — nothing to push. Settle any open rows so a stale
  // queue entry can't keep retrying a create that will always be rejected.
  if (customer.quickbooks_customer_id) {
    await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({ status: 'synced', error_message: null, updated_at: now })
      .eq('entity_type', 'customer')
      .eq('entity_id', customerId)
      .in('status', ['pending', 'held', 'failed'])

    return { ok: true, queued: false, reason: 'customer already in quickbooks' }
  }

  const syncStatus = getQuickBooksSyncStatus()

  const { data: openRows, error: openRowsError } = await supabase
    .from('ops_quickbooks_sync_jobs')
    .select('id')
    .eq('entity_type', 'customer')
    .eq('entity_id', customerId)
    .in('status', ['pending', 'held', 'failed'])
    .order('created_at', { ascending: false })

  if (openRowsError) throw openRowsError

  // Collapse to a single open row carrying the freshest payload.
  if (openRows && openRows.length > 0) {
    const [primaryRow, ...duplicateRows] = openRows

    const { error: updateError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({
        status: syncStatus,
        payload,
        error_message: null,
        updated_at: now,
      })
      .eq('id', primaryRow.id)
    if (updateError) throw updateError

    if (duplicateRows.length > 0) {
      const { error: deleteError } = await supabase
        .from('ops_quickbooks_sync_jobs')
        .delete()
        .in(
          'id',
          duplicateRows.map((row) => row.id),
        )
      if (deleteError) throw deleteError
    }

    return { ok: true, queued: true, status: syncStatus }
  }

  const { error: insertError } = await supabase
    .from('ops_quickbooks_sync_jobs')
    .insert({
      entity_type: 'customer',
      entity_id: customerId,
      status: syncStatus,
      payload,
    })
  if (insertError) throw insertError

  return { ok: true, queued: true, status: syncStatus }
}

type EnsureInvoiceSyncJobResult =
  | { ok: true; queued: true; status: 'pending' | 'held' | 'synced' | 'failed' }
  | { ok: true; queued: false; reason: string }

export async function ensureInvoiceQuickBooksSyncJob(
  supabase: AdminClient,
  invoiceId: string,
): Promise<EnsureInvoiceSyncJobResult> {
  const { data: invoice, error } = await supabase
    .from('ops_invoices')
    .select(
      `
      id,
      status,
      payment_method,
      quickbooks_invoice_id,
      ops_appointments!inner ( kind )
    `,
    )
    .eq('id', invoiceId)
    .maybeSingle()

  if (error) throw error
  if (!invoice) return { ok: true, queued: false, reason: 'invoice not found' }

  const appointment = Array.isArray(invoice.ops_appointments)
    ? invoice.ops_appointments[0]
    : invoice.ops_appointments
  if (appointment?.kind === 'estimate') {
    return { ok: true, queued: false, reason: 'estimate invoice' }
  }
  if (invoice.quickbooks_invoice_id) {
    return { ok: true, queued: false, reason: 'already synced' }
  }
  if (invoice.status === 'draft') {
    return { ok: true, queued: false, reason: 'invoice still draft' }
  }
  if (invoice.payment_method === 'cash') {
    await supabase
      .from('ops_invoices')
      .update({
        sync_status: 'held',
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
    return { ok: true, queued: false, reason: 'cash payment' }
  }

  const syncStatus = getQuickBooksSyncStatus()
  const now = new Date().toISOString()
  const payload = { invoice_id: invoiceId }

  const { data: existingRows, error: existingError } = await supabase
    .from('ops_quickbooks_sync_jobs')
    .select('id')
    .eq('entity_type', 'invoice')
    .eq('entity_id', invoiceId)
    .in('status', ['pending', 'held', 'failed', 'synced'])
    .order('created_at', { ascending: false })

  if (existingError) throw existingError

  if (existingRows && existingRows.length > 0) {
    const [primaryRow, ...duplicateRows] = existingRows
    const { error: updateError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .update({
        status: syncStatus,
        payload,
        error_message: null,
        updated_at: now,
      })
      .eq('id', primaryRow.id)
    if (updateError) throw updateError

    if (duplicateRows.length > 0) {
      const { error: deleteError } = await supabase
        .from('ops_quickbooks_sync_jobs')
        .delete()
        .in(
          'id',
          duplicateRows.map((row) => row.id),
        )
      if (deleteError) throw deleteError
    }
  } else {
    const { error: insertError } = await supabase
      .from('ops_quickbooks_sync_jobs')
      .insert({
        entity_type: 'invoice',
        entity_id: invoiceId,
        status: syncStatus,
        payload,
      })
    if (insertError) throw insertError
  }

  await supabase
    .from('ops_invoices')
    .update({ sync_status: syncStatus, updated_at: now })
    .eq('id', invoiceId)

  return { ok: true, queued: true, status: syncStatus }
}
