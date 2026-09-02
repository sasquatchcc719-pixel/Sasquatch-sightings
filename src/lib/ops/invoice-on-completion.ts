import type { SupabaseClient } from '@supabase/supabase-js'
import { getQuickBooksSyncStatus } from '@/lib/quickbooks'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'

export type InvoiceOnCompletionResult =
  | {
      promoted: false
      reason: 'no_invoice' | 'not_draft' | 'batch_monthly' | 'restoration'
    }
  | { promoted: true; invoiceId: string }

/**
 * Raise a finished job's invoice out of draft and queue it for QuickBooks.
 *
 * A new appointment's invoice starts as `draft`, and the QuickBooks worker
 * deliberately skips drafts — "deferred: invoice still draft (syncs when job
 * completes)". So something has to promote it when the job is finished, or the
 * invoice waits forever for a signal that already happened.
 *
 * That promotion lived only in the admin appointments route. The tech portal
 * marked jobs completed and did none of it, so a job David finished on his
 * phone was never billed and never reached QuickBooks. It surfaced when
 * Recovery Village's 8 July tile-and-grout job — $1,553.60, completed from the
 * tech portal at 18:27 — was missing from their July invoice two months later.
 *
 * Both routes now call this, so the two cannot drift apart again.
 *
 * Skipped for two kinds of job, both deliberately:
 *  - `batch_monthly` recurring work, which is billed as one monthly invoice
 *    rather than per visit
 *  - restoration visits, which invoice once for the whole project at close
 */
export async function promoteInvoiceOnJobCompletion(
  supabase: SupabaseClient,
  params: { appointmentId: string; userId: string; note: string },
): Promise<InvoiceOnCompletionResult> {
  const { appointmentId, userId, note } = params

  const { data: appt } = await supabase
    .from('ops_appointments')
    .select(
      'id, kind, visit_type, restoration_project_id, recurring_template_id',
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (
    appt?.kind === 'restoration' ||
    appt?.visit_type ||
    appt?.restoration_project_id
  ) {
    return { promoted: false, reason: 'restoration' }
  }

  if (appt?.recurring_template_id) {
    const { data: tpl } = await supabase
      .from('ops_recurring_templates')
      .select('invoice_mode')
      .eq('id', appt.recurring_template_id)
      .maybeSingle()
    if (tpl?.invoice_mode === 'batch_monthly') {
      return { promoted: false, reason: 'batch_monthly' }
    }
  }

  const { data: inv } = await supabase
    .from('ops_invoices')
    .select('id, status')
    .eq('appointment_id', appointmentId)
    .maybeSingle()

  if (!inv?.id) return { promoted: false, reason: 'no_invoice' }

  if (inv.status !== 'draft') {
    // Already past draft — still make sure it is queued, since a job can be
    // completed more than once and the earlier attempt may have failed.
    await ensureInvoiceQuickBooksSyncJob(supabase, inv.id)
    return { promoted: false, reason: 'not_draft' }
  }

  await supabase
    .from('ops_invoices')
    .update({
      status: 'ready',
      sync_status: getQuickBooksSyncStatus(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', inv.id)

  await supabase.from('ops_invoice_status_events').insert({
    invoice_id: inv.id,
    from_status: 'draft',
    to_status: 'ready',
    changed_by: userId,
    notes: note,
  })

  await ensureInvoiceQuickBooksSyncJob(supabase, inv.id)
  return { promoted: true, invoiceId: inv.id }
}
