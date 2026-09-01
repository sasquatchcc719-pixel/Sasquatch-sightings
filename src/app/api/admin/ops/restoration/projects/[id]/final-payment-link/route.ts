import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { createSquarePaymentLink } from '@/lib/payments/square'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { getRestorationBalanceCents } from '@/lib/ops/restoration-balance'

/**
 * Text the customer a Square-hosted checkout page for what's left on a
 * restoration project. Unlike the carpet invoice's payment link, the amount
 * is the live balance (net of any deposit already taken), computed
 * server-side — never trust a client-supplied amount here, since this is the
 * one thing standing between a customer and a double charge.
 *
 * Tracked on restoration_projects, not ops_invoices: the carpet webhook
 * expects a link's amount to equal the invoice total, which a restoration
 * balance-due link deliberately is not. The Square webhook has a matching
 * branch that recognizes final_payment_link_order_id and records the
 * payment once Square confirms it — see api/webhooks/square/route.ts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher', 'tech'])
    const { id } = await params
    const supabase = createAdminClient()

    const { data: project } = await supabase
      .from('restoration_projects')
      .select(
        `id, invoice_id,
         ops_customers!restoration_projects_customer_id_fkey ( full_name, business_name, phone )`,
      )
      .eq('id', id)
      .maybeSingle()
    if (!project)
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 })

    const customer = Array.isArray(project.ops_customers)
      ? project.ops_customers[0]
      : project.ops_customers
    const customerName =
      customer?.business_name || customer?.full_name || 'Valued Customer'
    const customerPhone = customer?.phone ?? null
    if (!customerPhone) {
      return NextResponse.json(
        { error: 'No phone number on file for this customer.' },
        { status: 422 },
      )
    }

    const balance = await getRestorationBalanceCents(supabase, id)
    if (!balance || balance.balanceCents <= 0) {
      return NextResponse.json(
        { error: 'Nothing is owed on this project.' },
        { status: 422 },
      )
    }

    let invoiceNumber: number | string = id.slice(0, 8)
    if (project.invoice_id) {
      const { data: invoice } = await supabase
        .from('ops_invoices')
        .select('invoice_number')
        .eq('id', project.invoice_id)
        .maybeSingle()
      if (invoice?.invoice_number) invoiceNumber = invoice.invoice_number
    }

    const amount = balance.balanceCents / 100
    const paymentLink = await createSquarePaymentLink({
      invoiceId: id,
      invoiceNumber,
      amount,
      customerName,
      description: 'Water mitigation — final balance',
      idempotencyKey: `restoration-final-${id}-${balance.balanceCents}`,
    })

    const { error: updateError } = await supabase
      .from('restoration_projects')
      .update({
        final_payment_link_id: paymentLink.id,
        final_payment_link_order_id: paymentLink.orderId,
        final_payment_link_url: paymentLink.url,
        final_payment_link_cents: balance.balanceCents,
      })
      .eq('id', id)
    if (updateError) throw updateError

    const body = [
      `Hi ${customerName} — here's the remaining balance on your water mitigation project from Sasquatch Carpet Cleaning.`,
      ``,
      `Balance due: $${amount.toFixed(2)}`,
      `Pay securely by card: ${paymentLink.url}`,
      ``,
      `Questions? Call or text us anytime. Thank you!`,
    ].join('\n')

    const sms = await sendCustomerSMSWithResult(
      customerPhone,
      body,
      undefined,
      'restoration_final_payment_link',
      undefined,
      { invoiceId: project.invoice_id ?? undefined },
    )

    return NextResponse.json({ ok: true, payment_url: paymentLink.url, sms })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : 'Failed to send payment link'
    return NextResponse.json(
      { error: message },
      { status: message === 'Not authorized' ? 403 : 500 },
    )
  }
}
