import { SupabaseClient } from '@supabase/supabase-js'
import { CompletedSquarePayment } from '@/lib/payments/square-webhook'
import { getMostRecentVisitId } from '@/lib/ops/restoration-balance'

export type RestorationWebhookResult =
  | { outcome: 'unmatched' }
  | { outcome: 'already_paid'; projectId: string }
  | { outcome: 'amount_mismatch'; projectId: string }
  | { outcome: 'recorded'; projectId: string }

/**
 * Restoration final-payment links are tracked on restoration_projects, not
 * ops_invoices, because they're charged for the balance due — deliberately
 * less than invoice.total whenever a deposit was already taken. The generic
 * invoice branch in the webhook requires the payment to cover the full
 * invoice total, which a balance-due link never will, so restoration gets its
 * own match and its own (lower) bar: the payment must cover what the link
 * asked for.
 *
 * Unlike a carpet invoice, there's no ops_invoices row to flip to "paid" — the
 * source of truth for what a restoration project owes is the sum of
 * ops_payments rows, so success here means writing one of those.
 */
export async function handleRestorationFinalPayment(
  supabase: SupabaseClient,
  payment: CompletedSquarePayment,
): Promise<RestorationWebhookResult> {
  const { data: project, error } = await supabase
    .from('restoration_projects')
    .select('id, invoice_id, final_payment_link_cents, final_payment_paid_at')
    .eq('final_payment_link_order_id', payment.orderId)
    .maybeSingle()
  if (error) throw error
  if (!project) return { outcome: 'unmatched' }

  if (project.final_payment_paid_at) {
    return { outcome: 'already_paid', projectId: project.id }
  }

  const expectedCents = Number(project.final_payment_link_cents || 0)
  if (
    payment.currency !== 'USD' ||
    expectedCents <= 0 ||
    payment.amountCents < expectedCents
  ) {
    console.error(
      `[webhooks/square] Payment ${payment.paymentId} did not cover restoration project ${project.id}`,
    )
    return { outcome: 'amount_mismatch', projectId: project.id }
  }

  const appointmentId = await getMostRecentVisitId(supabase, project.id)
  const nowIso = new Date().toISOString()

  const { error: paymentError } = await supabase.from('ops_payments').insert({
    appointment_id: appointmentId,
    invoice_id: project.invoice_id ?? null,
    kind: 'payment',
    method: 'square_link',
    amount_cents: payment.amountCents,
    square_payment_id: payment.paymentId,
    paid_at: payment.paidAt,
    note: 'Water mitigation final payment (Square payment link)',
  })
  // A retried webhook delivery duplicates square_payment_id, which is a no-op
  // rather than a double credit — same protection the deposit path relies on.
  if (paymentError && !String(paymentError.message).includes('duplicate key')) {
    throw paymentError
  }

  const { error: projectError } = await supabase
    .from('restoration_projects')
    .update({ final_payment_paid_at: nowIso })
    .eq('id', project.id)
    .is('final_payment_paid_at', null)
  if (projectError) throw projectError

  return { outcome: 'recorded', projectId: project.id }
}
