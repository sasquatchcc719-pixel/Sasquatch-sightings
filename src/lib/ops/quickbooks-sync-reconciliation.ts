import type { SupabaseClient } from '@supabase/supabase-js'
import { promoteInvoiceOnJobCompletion } from '@/lib/ops/invoice-on-completion'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'

type InvoiceCandidate = {
  id: string
  status: string
  sync_status: string | null
  payment_method: string | null
  quickbooks_invoice_id: string | null
  ops_appointments: AppointmentCandidate | AppointmentCandidate[] | null
}

type AppointmentCandidate = {
  id: string
  status: string
  kind: string | null
  visit_type: string | null
  restoration_project_id: string | null
  recurring_template_id: string | null
}

type ReconciliationContext = {
  hasBlockingJob: boolean
  isInBatchInvoice: boolean
  recurringInvoiceMode: string | null
}

export type InvoiceReconciliationAction = 'promote' | 'queue' | null

function unwrapAppointment(invoice: InvoiceCandidate) {
  return Array.isArray(invoice.ops_appointments)
    ? (invoice.ops_appointments[0] ?? null)
    : invoice.ops_appointments
}

export function getInvoiceReconciliationAction(
  invoice: InvoiceCandidate,
  appointment: AppointmentCandidate | null,
  context: ReconciliationContext,
): InvoiceReconciliationAction {
  if (
    !appointment ||
    invoice.quickbooks_invoice_id ||
    context.isInBatchInvoice ||
    context.recurringInvoiceMode === 'batch_monthly' ||
    appointment.kind === 'estimate' ||
    appointment.kind === 'restoration' ||
    appointment.visit_type ||
    appointment.restoration_project_id
  ) {
    return null
  }

  if (invoice.status === 'draft') {
    return appointment.status === 'completed' ? 'promote' : null
  }

  if (
    !['ready', 'sent', 'paid'].includes(invoice.status) ||
    invoice.payment_method === 'cash' ||
    invoice.sync_status === 'held' ||
    invoice.sync_status === 'synced' ||
    context.hasBlockingJob
  ) {
    return null
  }

  return invoice.status === 'paid' || appointment.status === 'completed'
    ? 'queue'
    : null
}

/**
 * Restore the invariant that every completed job or paid invoice has a path
 * to QuickBooks. Route-level enqueue calls provide the fast path; this scan is
 * the backstop when a route fails after changing state or a future code path
 * forgets to enqueue the invoice.
 */
export async function reconcileMissingInvoiceQuickBooksJobs(
  supabase: SupabaseClient,
): Promise<{
  inspected: number
  promotedDrafts: number
  queuedInvoices: number
}> {
  const candidateSelect = `
    id,
    status,
    sync_status,
    payment_method,
    quickbooks_invoice_id,
    ops_appointments!inner (
      id,
      status,
      kind,
      visit_type,
      restoration_project_id,
      recurring_template_id
    )
  `

  const [draftResult, queueResult] = await Promise.all([
    supabase
      .from('ops_invoices')
      .select(candidateSelect)
      .is('quickbooks_invoice_id', null)
      .eq('status', 'draft')
      .eq('ops_appointments.status', 'completed')
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('ops_invoices')
      .select(candidateSelect)
      .is('quickbooks_invoice_id', null)
      .in('status', ['ready', 'sent', 'paid'])
      .in('sync_status', ['pending', 'failed'])
      .order('created_at', { ascending: true })
      .limit(500),
  ])

  if (draftResult.error) throw draftResult.error
  if (queueResult.error) throw queueResult.error

  const candidatesById = new Map<string, InvoiceCandidate>()
  for (const row of [
    ...(draftResult.data || []),
    ...(queueResult.data || []),
  ] as InvoiceCandidate[]) {
    candidatesById.set(row.id, row)
  }
  const candidates = [...candidatesById.values()]
  if (candidates.length === 0) {
    return { inspected: 0, promotedDrafts: 0, queuedInvoices: 0 }
  }

  const appointmentIds = candidates
    .map(unwrapAppointment)
    .filter((row): row is AppointmentCandidate => Boolean(row))
    .map((row) => row.id)
  const invoiceIds = candidates.map((row) => row.id)
  const templateIds = [
    ...new Set(
      candidates
        .map(unwrapAppointment)
        .map((row) => row?.recurring_template_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const [batchResult, jobsResult, templatesResult] = await Promise.all([
    supabase
      .from('ops_batch_invoice_entries')
      .select('appointment_id')
      .in('appointment_id', appointmentIds),
    supabase
      .from('ops_quickbooks_sync_jobs')
      .select('entity_id')
      .eq('entity_type', 'invoice')
      .in('entity_id', invoiceIds)
      .in('status', ['pending', 'held', 'failed']),
    templateIds.length > 0
      ? supabase
          .from('ops_recurring_templates')
          .select('id, invoice_mode')
          .in('id', templateIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (batchResult.error) throw batchResult.error
  if (jobsResult.error) throw jobsResult.error
  if (templatesResult.error) throw templatesResult.error

  const batchedAppointmentIds = new Set(
    (batchResult.data || []).map((row) => row.appointment_id),
  )
  const blockedInvoiceIds = new Set(
    (jobsResult.data || []).map((row) => row.entity_id),
  )
  const invoiceModeByTemplateId = new Map(
    (templatesResult.data || []).map((row) => [row.id, row.invoice_mode]),
  )

  let promotedDrafts = 0
  let queuedInvoices = 0

  for (const invoice of candidates) {
    const appointment = unwrapAppointment(invoice)
    const action = getInvoiceReconciliationAction(invoice, appointment, {
      hasBlockingJob: blockedInvoiceIds.has(invoice.id),
      isInBatchInvoice: appointment
        ? batchedAppointmentIds.has(appointment.id)
        : false,
      recurringInvoiceMode: appointment?.recurring_template_id
        ? invoiceModeByTemplateId.get(appointment.recurring_template_id) || null
        : null,
    })

    if (action === 'promote' && appointment) {
      const result = await promoteInvoiceOnJobCompletion(supabase, {
        appointmentId: appointment.id,
        userId: null,
        note: 'Automated reconciliation repaired a completed draft invoice',
      })
      if (result.promoted) promotedDrafts++
    } else if (action === 'queue') {
      const result = await ensureInvoiceQuickBooksSyncJob(supabase, invoice.id)
      if (result.queued) queuedInvoices++
    }
  }

  return { inspected: candidates.length, promotedDrafts, queuedInvoices }
}
