import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getChargeableInvoice } from '@/lib/tech/appointments'
import { parseSquarePosReturn } from '@/lib/payments/square-pos'
import {
  verifySquarePosContext,
  verifySquarePosPayment,
} from '@/lib/payments/square-pos-verification'
import { createAdminClient } from '@/supabase/server'
import { ensureInvoiceQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'

/** Fixed Square callback URL. State proves the original staff-authorized launch;
 * server-side order/payment reads prove collection before any paid status changes. */
export async function GET(request: NextRequest) {
  let jobUrl = new URL('/tech', request.nextUrl.origin)
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const result = parseSquarePosReturn(request.nextUrl.searchParams)
    const context = verifySquarePosContext(result?.state || '')
    if (context.purpose !== 'invoice' || context.actorId !== access.id)
      throw new Error('Not authorized')
    const returnUrl = new URL(context.returnTo, request.nextUrl.origin)
    if (
      !context.returnTo.startsWith('/') ||
      context.returnTo.includes('\\') ||
      returnUrl.origin !== request.nextUrl.origin
    )
      throw new Error('Invalid payment return.')
    jobUrl = returnUrl
    if (!result || result.status === 'error') {
      const code = result?.status === 'error' ? result.errorCode || '' : ''
      jobUrl.searchParams.set(
        'payment',
        /cancel/i.test(code) ? 'canceled' : 'error',
      )
      return NextResponse.redirect(jobUrl)
    }
    if (!result.transactionId)
      throw new Error('Square payment is not available yet.')
    const supabase = createAdminClient()
    const invoice = await getChargeableInvoice(supabase, {
      role: access.role,
      userId: access.staff?.id ?? access.id,
      appointmentId: context.appointmentId,
    })
    if (
      !invoice ||
      invoice.invoiceId !== context.invoiceId ||
      Math.round(invoice.total * 100) !== context.amountCents
    )
      throw new Error('Invoice changed after the payment was started.')
    const payment = await verifySquarePosPayment(result.transactionId, context)
    const { data: current, error: currentError } = await supabase
      .from('ops_invoices')
      .select('square_payment_id')
      .eq('id', invoice.invoiceId)
      .maybeSingle()
    if (
      currentError ||
      !current ||
      (current.square_payment_id &&
        current.square_payment_id !== payment.paymentId)
    )
      throw new Error('Invoice already has another payment.')
    const nowIso = new Date().toISOString()
    const update = supabase
      .from('ops_invoices')
      .update({
        status: 'paid',
        payment_status: 'paid',
        payment_method: 'square',
        square_payment_id: payment.paymentId,
        square_order_id: payment.orderId,
        square_paid_cents: payment.amountCents,
        square_paid_at: payment.paidAt,
        updated_at: nowIso,
      })
      .eq('id', invoice.invoiceId)
      .eq('total', invoice.total)
    const guarded = current.square_payment_id
      ? update.eq('square_payment_id', payment.paymentId)
      : update.is('square_payment_id', null)
    const { data: saved, error: invoiceError } = await guarded
      .select('id')
      .maybeSingle()
    if (invoiceError || !saved)
      throw new Error('Invoice changed during payment verification.')
    const { error: appointmentError } = await supabase
      .from('ops_appointments')
      .update({ payment_status: 'paid', updated_at: nowIso })
      .eq('id', context.appointmentId)
    if (appointmentError) throw appointmentError
    await ensureInvoiceQuickBooksSyncJob(supabase, invoice.invoiceId)
    jobUrl.searchParams.set('payment', 'success')
  } catch {
    // Collection may have completed even when verification is temporarily unavailable.
    // Do not claim success or encourage a second charge.
    jobUrl.searchParams.set('payment', 'verification_pending')
  }
  return NextResponse.redirect(jobUrl)
}
