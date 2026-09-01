import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { parseSquarePosReturn } from '@/lib/payments/square-pos'

/**
 * Where Square Point of Sale sends the user back after taking a deposit.
 *
 * Records the payment against the visit. The deposit has no invoice yet — the
 * project's invoice is not built until the job closes days later, and
 * closeRestorationProject attaches it then.
 */
export async function GET(request: NextRequest) {
  const result = parseSquarePosReturn(request.nextUrl.searchParams)

  let appointmentId = ''
  let amountCents = 0
  let returnPath = ''
  let kind: 'deposit' | 'payment' = 'deposit'
  if (result?.state) {
    try {
      const parsed = JSON.parse(result.state) as {
        a?: string
        c?: number
        r?: string
        k?: string
      }
      if (typeof parsed.a === 'string') appointmentId = parsed.a
      if (typeof parsed.c === 'number') amountCents = parsed.c
      if (typeof parsed.r === 'string') returnPath = parsed.r
      if (parsed.k === 'payment') kind = 'payment'
    } catch {
      // A malformed state means we cannot safely record anything.
    }
  }

  const safeReturn =
    returnPath.startsWith('/') && !returnPath.startsWith('//')
      ? returnPath
      : '/admin/operations'
  const destination = new URL(safeReturn, request.nextUrl.origin)

  if (!result || result.status === 'error') {
    const canceled =
      result?.status === 'error' && /cancel/i.test(result.errorCode || '')
    destination.searchParams.set('deposit', canceled ? 'canceled' : 'error')
    return NextResponse.redirect(destination)
  }

  if (!appointmentId || amountCents <= 0) {
    destination.searchParams.set('deposit', 'error')
    return NextResponse.redirect(destination)
  }

  try {
    const supabase = createAdminClient()

    // Square can deliver the same return more than once; the unique index on
    // square_payment_id makes a repeat a no-op rather than a double credit.
    const { error } = await supabase.from('ops_payments').insert({
      appointment_id: appointmentId,
      kind,
      method: 'square_tap',
      amount_cents: amountCents,
      square_payment_id: result.transactionId,
      paid_at: new Date().toISOString(),
      note:
        kind === 'payment'
          ? 'Water mitigation final payment (Square POS)'
          : 'Water mitigation deposit (Square POS)',
    })

    if (error && !String(error.message).includes('duplicate key')) throw error
    destination.searchParams.set('deposit', 'paid')
  } catch (e) {
    console.error('[restoration/deposit-return]', e)
    destination.searchParams.set('deposit', 'error')
  }

  return NextResponse.redirect(destination)
}
