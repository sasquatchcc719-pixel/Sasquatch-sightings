import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { parseSquarePosReturn } from '@/lib/payments/square-pos'
import {
  verifySquarePosContext,
  verifySquarePosPayment,
} from '@/lib/payments/square-pos-verification'

/** The redirect is untrusted: only signed launch context and provider-verified
 * card payments can credit a restoration visit. No charge is made here. */
export async function GET(request: NextRequest) {
  const fallback = new URL('/admin/operations', request.nextUrl.origin)
  let destination = fallback
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const result = parseSquarePosReturn(request.nextUrl.searchParams)
    const context = verifySquarePosContext(result?.state || '')
    if (context.purpose !== 'restoration' || context.actorId !== access.id)
      throw new Error('Not authorized')
    const returnUrl = new URL(context.returnTo, request.nextUrl.origin)
    if (
      !context.returnTo.startsWith('/') ||
      context.returnTo.includes('\\') ||
      returnUrl.origin !== request.nextUrl.origin
    )
      throw new Error('Invalid payment return.')
    destination = returnUrl
    if (!result || result.status === 'error') {
      const canceled =
        result?.status === 'error' && /cancel/i.test(result.errorCode || '')
      destination.searchParams.set('deposit', canceled ? 'canceled' : 'error')
      return NextResponse.redirect(destination)
    }
    if (!result.transactionId)
      throw new Error('Square payment is not available yet.')
    const supabase = createAdminClient()
    const { data: appointment, error: appointmentError } = await supabase
      .from('ops_appointments')
      .select('id, restoration_project_id, assigned_staff_user_id')
      .eq('id', context.appointmentId)
      .maybeSingle()
    if (
      appointmentError ||
      !appointment?.restoration_project_id ||
      (access.role === 'tech' &&
        appointment.assigned_staff_user_id !== access.staff?.id)
    )
      throw new Error('Not authorized')
    const payment = await verifySquarePosPayment(result.transactionId, context)
    const { error } = await supabase.from('ops_payments').insert({
      appointment_id: context.appointmentId,
      kind: context.kind,
      method: 'square_tap',
      amount_cents: payment.amountCents,
      square_payment_id: payment.paymentId,
      square_order_id: payment.orderId,
      paid_at: payment.paidAt,
      recorded_by_user_id: access.id,
      note:
        context.kind === 'payment'
          ? 'Water mitigation final payment (Square POS)'
          : 'Water mitigation deposit (Square POS)',
    })
    if (error) {
      if (error.code !== '23505') throw error
      const { data: saved, error: savedError } = await supabase
        .from('ops_payments')
        .select('appointment_id, kind, amount_cents')
        .eq('square_payment_id', payment.paymentId)
        .maybeSingle()
      if (
        savedError ||
        saved?.appointment_id !== context.appointmentId ||
        saved.kind !== context.kind ||
        Number(saved.amount_cents) !== payment.amountCents
      )
        throw new Error('Payment is already recorded elsewhere.')
    }
    destination.searchParams.set('deposit', 'paid')
  } catch {
    destination.searchParams.set('deposit', 'error')
  }
  return NextResponse.redirect(destination)
}
