import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

/**
 * Remove a payment recorded by hand.
 *
 * Recording a payment that was taken elsewhere is easy to do twice — the same
 * $1,000 entered on the mitigation day and again on a monitor day quietly halves
 * what the customer is billed. So the record has to be removable.
 *
 * Only a payment with no invoice attached can go: once the project has closed,
 * the payment belongs to an invoice and to the revenue that was recorded from
 * it, and unpicking that is an invoice correction rather than a typo fix.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const { paymentId } = await params
    const supabase = createAdminClient()

    const { data: payment } = await supabase
      .from('ops_payments')
      .select('id, invoice_id, square_payment_id')
      .eq('id', paymentId)
      .maybeSingle()

    if (!payment) return NextResponse.json({ ok: true })
    if (payment.invoice_id) {
      return NextResponse.json(
        { error: 'payment_belongs_to_an_invoice' },
        { status: 409 },
      )
    }

    const { error } = await supabase.from('ops_payments').delete().eq('id', paymentId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to remove payment'
    return NextResponse.json({ error: message }, { status: message === 'Not authorized' ? 403 : 500 })
  }
}
