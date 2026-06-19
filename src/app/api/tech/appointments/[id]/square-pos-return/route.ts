import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { getAssignedTechAppointment } from '@/lib/tech/appointments'
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
  const jobUrl = new URL(`/tech/jobs/${id}`, request.nextUrl.origin)

  const result = parseSquarePosReturn(request.nextUrl.searchParams)

  // Customer canceled or Square errored — don't mark paid; tell the tech.
  if (!result || result.status === 'error') {
    const code = result?.status === 'error' ? result.errorCode || '' : ''
    const canceled = /cancel/i.test(code)
    jobUrl.searchParams.set('payment', canceled ? 'canceled' : 'error')
    return NextResponse.redirect(jobUrl)
  }

  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const staffUserId = access.staff?.id ?? access.id
    const appointment = await getAssignedTechAppointment(
      supabase,
      staffUserId,
      id,
    )

    if (appointment?.invoice && !appointment.hidePricing) {
      const nowIso = new Date().toISOString()
      await supabase
        .from('ops_invoices')
        .update({
          status: 'paid',
          payment_status: 'paid',
          payment_method: 'square',
          updated_at: nowIso,
        })
        .eq('id', appointment.invoice.id)
      await supabase
        .from('ops_appointments')
        .update({ payment_status: 'paid', updated_at: nowIso })
        .eq('id', id)
      console.log(
        `[square-pos-return] Marked invoice ${appointment.invoice.id} paid (txn ${result.transactionId ?? 'n/a'})`,
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
