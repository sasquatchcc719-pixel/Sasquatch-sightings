import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { assertTechInvoiceAccess } from '@/lib/ops/tech-job-access'
import {
  normalizeUsPhoneInput,
  sendCustomerSMS,
  sendCustomerSMSWithResult,
} from '@/lib/twilio'
import {
  getQBInvoicePaymentLink,
  syncAppointmentToQuickBooks,
} from '@/lib/quickbooks-api'
import { getQBConnectionStatus } from '@/lib/quickbooks-auth'
import { generateInvoicePDF } from '@/lib/ops/pdf/generate'
import { createSquarePaymentLink } from '@/lib/payments/square'
import { buildVenmoPaymentLink } from '@/lib/payments/venmo'
import {
  buildPublicPaymentUrl,
  createInvoicePaymentToken,
} from '@/lib/payments/signed-payment-link'
import { isBlacklisted } from '@/lib/blacklist'

const VENMO_USERNAME = process.env.VENMO_BUSINESS_USERNAME ?? 'SasquatchCarpet'

function publicSiteOrigin(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    request.nextUrl.origin
  ).replace(/\/+$/, '')
}

function invoicePaymentUrl(
  request: NextRequest,
  invoiceId: string,
  provider: 'square' | 'venmo',
): string {
  return buildPublicPaymentUrl(
    publicSiteOrigin(request),
    createInvoicePaymentToken({ invoiceId, provider }),
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to send invoice'
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

function buildPhotoGrid(photoUrls: string[]): string {
  if (photoUrls.length === 0) return ''
  const cells = photoUrls
    .slice(0, 6)
    .map(
      (url) =>
        `<td style="padding:4px;"><img src="${url}" width="160" height="160" style="border-radius:8px;object-fit:cover;display:block;" /></td>`,
    )
    .join('')
  return `
  <div style="margin-top:24px;">
    <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#374151;">Job Photos</p>
    <table style="border-collapse:collapse;"><tr>${cells}</tr></table>
  </div>`
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
  photoUrls: string[] = [],
  mode: 'invoice' | 'receipt' = 'invoice',
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

  const isReceipt = mode === 'receipt'
  const title = isReceipt ? 'Receipt' : 'Invoice'
  const intro = isReceipt
    ? 'Thank you for your payment. Here is your itemized receipt.'
    : "Thank you for choosing Sasquatch Carpet Cleaning. Here's your invoice."
  const totalLabel = isReceipt ? 'Amount Paid' : 'Total Due'
  const paymentCta = isReceipt
    ? ''
    : `
      <a href="${venmoUrl}" style="display:inline-block;background:#008CFF;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">
        Pay with Venmo — $${total.toFixed(2)}
      </a>`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

    <div style="background:#16a34a;padding:24px 32px;">
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Sasquatch Carpet Cleaning</h1>
      <p style="margin:4px 0 0;color:#bbf7d0;font-size:14px;">${title}</p>
    </div>

    <div style="padding:24px 32px;">
      <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111827;">Hi ${customerName},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6b7280;">${intro}</p>

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
            <td colspan="3" style="padding:12px 12px 0;text-align:right;font-weight:700;color:#111827;font-size:15px;">${totalLabel}</td>
            <td style="padding:12px 12px 0;text-align:right;font-weight:700;color:#16a34a;font-size:15px;">$${total.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">Service address: ${address}</p>
      <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Date: ${serviceDate}</p>

      ${paymentCta}

      ${buildPhotoGrid(photoUrls)}

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
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
    ])
    const supabase = createAdminClient()
    const { id } = await params
    await assertTechInvoiceAccess(supabase, access, id)
    const body = (await request.json()) as {
      channel: 'sms' | 'email' | 'both'
      type?:
        | 'invoice'
        | 'payment_link'
        | 'venmo_payment_link'
        | 'square_payment_link'
        | 'receipt'
      send_to_phone?: string
    }
    const { channel, type } = body

    if (!channel || !['sms', 'email', 'both'].includes(channel)) {
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
    }

    const rawSendToPhone =
      typeof body.send_to_phone === 'string' ? body.send_to_phone.trim() : ''
    const sendToPhoneOverride = rawSendToPhone
      ? normalizeUsPhoneInput(rawSendToPhone)
      : null
    if (rawSendToPhone && !sendToPhoneOverride) {
      return NextResponse.json(
        { error: 'Enter a valid 10-digit US phone number to send to.' },
        { status: 422 },
      )
    }

    // Fetch invoice with all data needed for the message
    const { data: invoice, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(
        `
        id,
        invoice_number,
        payment_status,
        total,
        subtotal,
        discount_amount,
        percentage_discount_amount,
        quickbooks_invoice_id,
        ops_appointments (
          id,
          appointment_date,
          ops_customers!ops_appointments_customer_id_fkey (
            full_name,
            business_name,
            email,
            phone,
            email_opt_out
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
    const customerPhone = sendToPhoneOverride ?? customer?.phone ?? null
    const customerEmail = customer?.email ?? null
    const customerEmailOptOut = customer?.email_opt_out === true
    const customerBlacklisted = customerPhone
      ? await isBlacklisted(customerPhone)
      : false
    const total = Number(invoice.total || 0)
    const invoiceNumber = Number(invoice.invoice_number || 0)
    if (!invoiceNumber) {
      return NextResponse.json(
        { error: 'Invoice number is missing for this invoice.' },
        { status: 422 },
      )
    }
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

    const venmoUrl = buildVenmoPaymentLink({
      username: VENMO_USERNAME,
      invoiceNumber,
      amount: total,
      customerName,
    })

    // Fetch any job photos to include in the email
    const rawAppt = invoice.ops_appointments
    const apptId: string | null = rawAppt
      ? Array.isArray(rawAppt)
        ? ((rawAppt[0] as { id?: string })?.id ?? null)
        : ((rawAppt as { id?: string })?.id ?? null)
      : null
    let photoUrls: string[] = []
    if (apptId) {
      const { data: photos } = await supabase
        .from('ops_job_photos')
        .select('public_url')
        .eq('appointment_id', apptId)
        .order('created_at', { ascending: true })
      photoUrls = (photos ?? []).map(
        (p: { public_url: string }) => p.public_url,
      )
    }

    const errors: string[] = []
    let emailDelivery: { to: string; id?: string } | null = null

    if (type === 'square_payment_link') {
      if (!customerPhone) {
        return NextResponse.json(
          { error: 'No phone number on file for this customer.' },
          { status: 422 },
        )
      }

      const paymentLink = await createSquarePaymentLink({
        invoiceId: id,
        invoiceNumber,
        amount: total,
        customerName,
        description: addressText,
      })
      const { error: squareLinkError } = await supabase
        .from('ops_invoices')
        .update({
          square_payment_link_id: paymentLink.id,
          square_order_id: paymentLink.orderId,
          square_payment_link_url: paymentLink.url,
          square_payment_link_cents: Math.round(total * 100),
        })
        .eq('id', id)
      if (squareLinkError) throw squareLinkError
      const customerPaymentUrl = invoicePaymentUrl(request, id, 'square')

      const linkBody = [
        `Hi ${customerName} — here's your invoice from Sasquatch Carpet Cleaning.`,
        ``,
        `Invoice #${invoiceNumber}`,
        `Total due: $${total.toFixed(2)}`,
        `Pay securely by card: ${customerPaymentUrl}`,
        ``,
        `Questions? Call or text us anytime. Thank you!`,
      ].join('\n')

      const sms = await sendCustomerSMSWithResult(
        customerPhone,
        linkBody,
        id,
        'square_payment_link',
      )
      return NextResponse.json({
        ok: true,
        payment_url: customerPaymentUrl,
        provider_payment_url: paymentLink.url,
        sms,
      })
    }

    if (type === 'venmo_payment_link') {
      if (!customerPhone) {
        return NextResponse.json(
          { error: 'No phone number on file for this customer.' },
          { status: 422 },
        )
      }
      const customerPaymentUrl = invoicePaymentUrl(request, id, 'venmo')

      const linkBody = [
        `Hi ${customerName} — here's your invoice from Sasquatch Carpet Cleaning.`,
        ``,
        `Invoice #${invoiceNumber}`,
        `Total due: $${total.toFixed(2)}`,
        `Pay with Venmo: ${customerPaymentUrl}`,
        ``,
        `Questions? Call or text us anytime. Thank you!`,
      ].join('\n')

      const sms = await sendCustomerSMSWithResult(
        customerPhone,
        linkBody,
        id,
        'venmo_payment_link',
      )
      return NextResponse.json({
        ok: true,
        payment_url: customerPaymentUrl,
        provider_payment_url: venmoUrl,
        sms,
      })
    }

    // Payment link SMS — fetch a QuickBooks invoice pay link and text it.
    // Do not silently fall back to Venmo here; this action is specifically
    // for proving the QuickBooks Payments flow.
    if (type === 'payment_link') {
      if (!customerPhone) {
        return NextResponse.json(
          { error: 'No phone number on file for this customer.' },
          { status: 422 },
        )
      }

      if (total <= 0) {
        return NextResponse.json(
          { error: 'Invoice total must be greater than zero.' },
          { status: 422 },
        )
      }

      const qbStatus = await getQBConnectionStatus()
      if (!qbStatus.connected || !qbStatus.sync_enabled) {
        return NextResponse.json(
          {
            error:
              'QuickBooks is not connected or invoice sync is turned off. Connect QuickBooks in Operations Settings first.',
          },
          { status: 422 },
        )
      }

      if (!appointment?.id) {
        return NextResponse.json(
          {
            error:
              'This invoice is not linked to a job, so it cannot sync to QuickBooks.',
          },
          { status: 422 },
        )
      }

      let paymentUrl: string | null = null
      let quickBooksInvoiceId = invoice.quickbooks_invoice_id

      if (!quickBooksInvoiceId) {
        try {
          await syncAppointmentToQuickBooks(appointment.id)
        } catch (syncError) {
          console.error(
            '[ops/invoices/:id/send][payment_link] QB sync failed:',
            syncError,
          )
          return NextResponse.json(
            {
              error:
                syncError instanceof Error
                  ? syncError.message
                  : 'QuickBooks sync failed before creating the payment link.',
            },
            { status: 422 },
          )
        }

        const { data: syncedInvoice } = await supabase
          .from('ops_invoices')
          .select('quickbooks_invoice_id')
          .eq('id', id)
          .single()
        quickBooksInvoiceId = syncedInvoice?.quickbooks_invoice_id ?? null
      }

      if (quickBooksInvoiceId) {
        paymentUrl = await getQBInvoicePaymentLink(quickBooksInvoiceId)
      }

      if (!paymentUrl) {
        return NextResponse.json(
          {
            error:
              'QuickBooks synced the invoice, but did not return an online payment link. Check that QuickBooks Payments is enabled for invoices.',
          },
          { status: 422 },
        )
      }

      const linkBody = [
        `Hi ${customerName} — here's your invoice from Sasquatch Carpet Cleaning.`,
        ``,
        `Total due: $${total.toFixed(2)}`,
        `Pay securely online: ${paymentUrl}`,
        ``,
        `Questions? Call or text us anytime. Thank you!`,
      ].join('\n')

      const sms = await sendCustomerSMSWithResult(
        customerPhone,
        linkBody,
        id,
        'payment_link',
      )
      return NextResponse.json({ ok: true, payment_url: paymentUrl, sms })
    }

    if (type === 'receipt' && channel !== 'email') {
      return NextResponse.json(
        { error: 'Receipts can only be emailed.' },
        { status: 400 },
      )
    }

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
      } else if (customerEmailOptOut || customerBlacklisted) {
        errors.push('Customer is suppressed from email communications.')
      } else {
        const resendKey = process.env.RESEND_API_KEY
        if (!resendKey) {
          errors.push('Email service not configured.')
        } else {
          const resend = new Resend(resendKey)
          const fromEmail =
            process.env.OPS_EMAIL_FROM ||
            'Sasquatch Carpet Cleaning <onboarding@resend.dev>'

          const discountAmount =
            Number(
              (invoice as { discount_amount?: number }).discount_amount || 0,
            ) +
            Number(
              (invoice as { percentage_discount_amount?: number })
                .percentage_discount_amount || 0,
            )
          const subtotal = Number(
            (invoice as { subtotal?: number }).subtotal || total,
          )

          const isReceipt = type === 'receipt'
          const pdfBuffer = await generateInvoicePDF({
            invoiceId: id,
            isPaid: isReceipt || invoice.payment_status === 'paid',
            customerName,
            serviceAddress: addressText,
            serviceDate,
            lineItems,
            discountAmount,
            subtotal,
            total,
            venmoUrl,
          })

          const shortRef = `INV-${id.replace(/-/g, '').slice(-6).toUpperCase()}`

          const { data: resendData, error: resendError } =
            await resend.emails.send({
              from: fromEmail,
              to: customerEmail,
              subject: isReceipt
                ? `Your receipt from Sasquatch Carpet Cleaning — $${total.toFixed(2)} paid`
                : `Your invoice from Sasquatch Carpet Cleaning — $${total.toFixed(2)} due`,
              html: buildEmailHtml(
                customerName,
                addressText,
                serviceDate,
                lineItems,
                total,
                venmoUrl,
                photoUrls,
                isReceipt ? 'receipt' : 'invoice',
              ),
              attachments: pdfBuffer
                ? [
                    {
                      filename: `${shortRef}.pdf`,
                      content: pdfBuffer,
                    },
                  ]
                : undefined,
            })

          if (resendError) {
            const msg =
              typeof resendError === 'object' &&
              resendError !== null &&
              'message' in resendError &&
              typeof (resendError as { message: unknown }).message === 'string'
                ? (resendError as { message: string }).message
                : 'Email provider rejected the message.'
            errors.push(msg)
          } else {
            emailDelivery = {
              to: customerEmail,
              id: resendData?.id,
            }
          }
        }
      }
    }

    if (errors.length > 0 && channel !== 'both') {
      return NextResponse.json({ error: errors[0] }, { status: 422 })
    }

    return NextResponse.json({
      ok: true,
      warnings: errors.length > 0 ? errors : undefined,
      email_delivery: emailDelivery ?? undefined,
    })
  } catch (error) {
    console.error('[ops/invoices/:id/send][POST] Error:', error)
    const message = errorMessage(error)
    const status = message === 'Not authorized' ? 401 : 500
    return NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : message },
      { status },
    )
  }
}
