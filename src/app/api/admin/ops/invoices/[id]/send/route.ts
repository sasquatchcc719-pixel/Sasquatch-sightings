import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { sendCustomerSMS } from '@/lib/twilio'

const VENMO_USERNAME = process.env.VENMO_BUSINESS_USERNAME ?? 'SasquatchCarpet'

function buildVenmoLink(total: number, customerName: string): string {
  const note = encodeURIComponent(`Sasquatch Carpet Cleaning - ${customerName}`)
  return `https://venmo.com/${VENMO_USERNAME}?txn=pay&amount=${total.toFixed(2)}&note=${note}`
}

function buildSmsBody(
  customerName: string,
  address: string,
  total: number,
  venmoUrl: string,
): string {
  return [
    `Hi ${customerName} — here's your invoice from Sasquatch Carpet Cleaning.`,
    ``,
    `Service address: ${address}`,
    `Total due: $${total.toFixed(2)}`,
    ``,
    `Pay via Venmo: ${venmoUrl}`,
    ``,
    `Questions? Call or text us anytime. Thank you!`,
  ].join('\n')
}

function buildEmailHtml(
  customerName: string,
  address: string,
  serviceDate: string,
  lineItems: Array<{
    description: string
    quantity: number
    unit_price: number
    line_total: number
  }>,
  total: number,
  venmoUrl: string,
): string {
  const itemRows = lineItems
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${Number(item.unit_price).toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${Number(item.line_total).toFixed(2)}</td>
        </tr>`,
    )
    .join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <div style="background:#16a34a;padding:24px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Sasquatch Carpet Cleaning</h1>
      <p style="margin:4px 0 0;color:#bbf7d0;font-size:14px;">Invoice</p>
    </div>

    <div style="padding:24px 32px;">
      <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111827;">Hi ${customerName},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">Thank you for choosing Sasquatch Carpet Cleaning. Here's your invoice.</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;">Description</th>
            <th style="padding:8px 12px;text-align:center;font-weight:600;color:#374151;">Qty</th>
            <th style="padding:8px 12px;text-align:right;font-weight:600;color:#374151;">Unit Price</th>
            <th style="padding:8px 12px;text-align:right;font-weight:600;color:#374151;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:12px 12px 0;text-align:right;font-weight:700;color:#111827;font-size:15px;">Total Due</td>
            <td style="padding:12px 12px 0;text-align:right;font-weight:700;color:#16a34a;font-size:15px;">$${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Service address: ${address}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Date: ${serviceDate}</p>

      <a href="${venmoUrl}" style="display:inline-block;background:#008CFF;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">
        Pay with Venmo — $${total.toFixed(2)}
      </a>

      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">Questions? Call or text us anytime. We appreciate your business!</p>
    </div>
  </div>
</body>
</html>`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = (await request.json()) as { channel: 'sms' | 'email' | 'both' }
    const { channel } = body

    if (!channel || !['sms', 'email', 'both'].includes(channel)) {
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
    }

    // Fetch invoice with all data needed for the message
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(
        `
        id,
        total,
        ops_appointments (
          appointment_date,
          ops_customers (
            full_name,
            business_name,
            email,
            phone
          ),
          ops_service_addresses (
            street_1,
            city,
            state,
            zip_code
          )
        ),
        ops_invoice_line_items (
          description,
          quantity,
          unit_price,
          line_total
        )
      `,
      )
      .eq('id', id)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const appointment = Array.isArray(invoice.ops_appointments)
      ? invoice.ops_appointments[0]
      : invoice.ops_appointments

    const customer = appointment
      ? Array.isArray(appointment.ops_customers)
        ? appointment.ops_customers[0]
        : appointment.ops_customers
      : null

    const address = appointment
      ? Array.isArray(appointment.ops_service_addresses)
        ? appointment.ops_service_addresses[0]
        : appointment.ops_service_addresses
      : null

    const customerName =
      customer?.business_name || customer?.full_name || 'Valued Customer'
    const customerPhone = customer?.phone ?? null
    const customerEmail = customer?.email ?? null
    const total = Number(invoice.total || 0)
    const serviceDate = appointment?.appointment_date ?? ''
    const addressText = address
      ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
      : 'your service address'

    const lineItems = (invoice.ops_invoice_line_items || []) as Array<{
      description: string
      quantity: number
      unit_price: number
      line_total: number
    }>

    const venmoUrl = buildVenmoLink(total, customerName)
    const errors: string[] = []

    // Send SMS
    if (channel === 'sms' || channel === 'both') {
      if (!customerPhone) {
        errors.push('No phone number on file for this customer.')
      } else {
        const smsBody = buildSmsBody(customerName, addressText, total, venmoUrl)
        await sendCustomerSMS(customerPhone, smsBody, id, 'invoice_send')
      }
    }

    // Send email
    if (channel === 'email' || channel === 'both') {
      if (!customerEmail) {
        errors.push('No email address on file for this customer.')
      } else {
        const resendKey = process.env.RESEND_API_KEY
        if (!resendKey) {
          errors.push('Email service not configured.')
        } else {
          const resend = new Resend(resendKey)
          const fromEmail =
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>'
          await resend.emails.send({
            from: fromEmail,
            to: customerEmail,
            subject: `Your invoice from Sasquatch Carpet Cleaning — $${total.toFixed(2)} due`,
            html: buildEmailHtml(
              customerName,
              addressText,
              serviceDate,
              lineItems,
              total,
              venmoUrl,
            ),
          })
        }
      }
    }

    if (errors.length > 0 && channel !== 'both') {
      return NextResponse.json({ error: errors[0] }, { status: 422 })
    }

    return NextResponse.json({
      ok: true,
      warnings: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[ops/invoices/:id/send][POST] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send invoice' },
      { status: 500 },
    )
  }
}
