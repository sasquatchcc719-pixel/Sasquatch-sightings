import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import {
  getAssignedTechAppointment,
  shouldHideTechPricing,
} from '@/lib/tech/appointments'
import { createSquarePaymentLink } from '@/lib/payments/square'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { createAdminClient } from '@/supabase/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'tech'])
    const supabase = createAdminClient()
    const { id } = await params
    const appointment = await getAssignedTechAppointment(
      supabase,
      access.id,
      id,
    )

    if (!appointment) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (appointment.hidePricing || !appointment.invoice) {
      return NextResponse.json(
        { error: 'Payment collection is unavailable for this job' },
        { status: 403 },
      )
    }

    const { data: current, error: currentError } = await supabase
      .from('ops_appointments')
      .select(
        `
          id,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name,
            phone
          ),
          ops_recurring_templates (
            invoice_mode
          )
        `,
      )
      .eq('id', id)
      .eq('assigned_staff_user_id', access.staff?.id ?? access.id)
      .single()

    if (currentError) throw currentError
    if (shouldHideTechPricing(current)) {
      return NextResponse.json(
        { error: 'Payment collection is unavailable for this job' },
        { status: 403 },
      )
    }

    const total = Number(appointment.invoice.total || 0)
    if (!Number.isFinite(total) || total <= 0) {
      return NextResponse.json(
        { error: 'Invoice total must be greater than zero' },
        { status: 422 },
      )
    }
    if (!appointment.customerPhone) {
      return NextResponse.json(
        { error: 'No phone number on file for this customer' },
        { status: 422 },
      )
    }

    const customerName =
      appointment.businessName || appointment.customerName || 'Valued Customer'
    const invoiceNumber = appointment.invoice.invoiceNumber
    if (!invoiceNumber) {
      return NextResponse.json(
        { error: 'Invoice number is missing for this invoice' },
        { status: 422 },
      )
    }
    const paymentUrl = await createSquarePaymentLink({
      invoiceId: appointment.invoice.id,
      invoiceNumber,
      amount: total,
      customerName,
      description: `Job ${appointment.id}`,
    })

    const smsBody = [
      `Hi ${customerName} — here's your invoice from Sasquatch Carpet Cleaning.`,
      ``,
      `Invoice #${invoiceNumber}`,
      `Total due: $${total.toFixed(2)}`,
      `Pay securely by card: ${paymentUrl}`,
      ``,
      `Questions? Call or text us anytime. Thank you!`,
    ].join('\n')

    const sms = await sendCustomerSMSWithResult(
      appointment.customerPhone,
      smsBody,
      appointment.invoice.id,
      'square_payment_link',
    )

    return NextResponse.json({ ok: true, payment_url: paymentUrl, sms })
  } catch (error) {
    console.error('[tech/appointments/:id/square-link][POST]', error)
    const status =
      error instanceof Error && error.message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      {
        error:
          status === 401
            ? 'Unauthorized'
            : error instanceof Error
              ? error.message
              : 'Failed to send Square payment link',
      },
      { status },
    )
  }
}
