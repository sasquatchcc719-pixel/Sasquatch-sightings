import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getChargeableInvoice } from '@/lib/tech/appointments'
import { parseSquarePosReturn } from '@/lib/payments/square-pos'
import { createAdminClient } from '@/supabase/server'

/**
 * Square Point of Sale switches back here after a tap-to-pay transaction.
 * On success we mark the invoice paid (method 'square') — equivalent to the
 * tech tapping "Mark Square Paid", but automatic — then redirect to the job.
 * The Square webhook (when configured) is the authoritative financial record;
 * this gives the tech instant in-app confirmation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // Return to the page the charge was started from (admin invoice or tech job);
  // only same-origin relative paths are honored.
  const rawReturn = request.nextUrl.searchParams.get('return_to')
  const returnPath =
    rawReturn && rawReturn.startsWith('/') && !rawReturn.startsWith('//')
      ? rawReturn
      : `/tech/jobs/${id}`
  const jobUrl = new URL(returnPath, request.nextUrl.origin)

  const result = parseSquarePosReturn(request.nextUrl.searchParams)

  // Customer canceled or Square errored — don't mark paid; tell the tech.
  if (!result || result.status === 'error') {
    const code = result?.status === 'error' ? result.errorCode || '' : ''
    const canceled = /cancel/i.test(code)
    jobUrl.searchParams.set('payment', canceled ? 'canceled' : 'error')
    return NextResponse.redirect(jobUrl)
  }

  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const invoice = await getChargeableInvoice(supabase, {
      role: access.role,
      userId: access.staff?.id ?? access.id,
      appointmentId: id,
    })

    if (invoice) {
      const nowIso = new Date().toISOString()
      await supabase
        .from('ops_invoices')
        .update({
          status: 'paid',
          payment_status: 'paid',
          payment_method: 'square',
          updated_at: nowIso,
        })
        .eq('id', invoice.invoiceId)
      await supabase
        .from('ops_appointments')
        .update({ payment_status: 'paid', updated_at: nowIso })
        .eq('id', id)
      console.log(
        `[square-pos-return] Marked invoice ${invoice.invoiceId} paid (txn ${result.transactionId ?? 'n/a'})`,
      )
    }
    jobUrl.searchParams.set('payment', 'success')
  } catch (error) {
    // Not authorized / lookup failed — the webhook backstop will still
    // reconcile the real payment. Send the tech back with a soft notice.
    console.error('[square-pos-return][GET]', error)
    jobUrl.searchParams.set('payment', 'received')
  }

  return NextResponse.redirect(jobUrl)
}
