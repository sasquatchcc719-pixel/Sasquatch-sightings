import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { chargeCardViaQB, createQBPayment } from '@/lib/quickbooks-api'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const { token } = body as { token: string }

    if (!token) {
      return NextResponse.json(
        { error: 'Card token is required' },
        { status: 400 },
      )
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(
        `
        id,
        total,
        quickbooks_invoice_id,
        ops_appointments (
          id,
          ops_customers!ops_appointments_customer_id_fkey (
            id,
            quickbooks_customer_id
          )
        )
      `,
      )
      .eq('id', id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const total = Number(invoice.total || 0)
    if (total <= 0) {
      return NextResponse.json(
        { error: 'Invoice total must be greater than zero' },
        { status: 400 },
      )
    }

    const charge = await chargeCardViaQB({
      token,
      amount: total,
    })

    if (charge.status !== 'CAPTURED') {
      return NextResponse.json(
        { error: `Charge was not captured. Status: ${charge.status}` },
        { status: 422 },
      )
    }

    const appointment = Array.isArray(invoice.ops_appointments)
      ? invoice.ops_appointments[0]
      : invoice.ops_appointments
    const customer = appointment
      ? Array.isArray(appointment.ops_customers)
        ? appointment.ops_customers[0]
        : appointment.ops_customers
      : null

    if (customer?.quickbooks_customer_id && invoice.quickbooks_invoice_id) {
      try {
        await createQBPayment({
          qbCustomerId: customer.quickbooks_customer_id,
          qbInvoiceId: invoice.quickbooks_invoice_id,
          amount: total,
          paymentMethod: 'card',
        })
      } catch (paymentErr) {
        console.error(
          '[invoices/:id/charge] QB payment record failed:',
          paymentErr,
        )
      }
    }

    await supabase
      .from('ops_invoices')
      .update({
        status: 'paid',
        payment_method: 'card',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({
      ok: true,
      chargeId: charge.chargeId,
    })
  } catch (error) {
    console.error('[invoices/:id/charge] Error:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to charge card'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
