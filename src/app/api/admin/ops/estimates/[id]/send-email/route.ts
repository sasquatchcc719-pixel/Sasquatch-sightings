import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { Resend } from 'resend'
import { buildEmailHtml } from '@/lib/ops/communications'
import { isAreaUnit, isLinearUnit } from '@/lib/ops/estimates'
import {
  buildEstimateDecisionUrl,
  createEstimateDecisionToken,
} from '@/lib/ops/estimate-decision-token'
import { isBlacklisted } from '@/lib/blacklist'

type EmailType = 'booking_confirmation' | 'quote'

function toLocalDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function toLocalTime(hhmm: string): string {
  try {
    const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  } catch {
    return hhmm.slice(0, 5)
  }
}

function buildBookingConfirmationBody(params: {
  firstName: string
  fullName: string
  date: string
  startTime: string
  endTime: string
  address: string
}): string {
  const { firstName, date, startTime, endTime, address } = params
  const greeting = firstName || 'there'

  return [
    `Hi ${greeting},`,
    `Thank you so much for reaching out to Sasquatch Carpet Cleaning — we truly appreciate the opportunity to earn your business.`,
    `We're looking forward to visiting your property to take a look at everything and provide you with a detailed, no-obligation estimate. Here are your appointment details:\n\n- Date: ${date}\n- Time: ${startTime} – ${endTime}\n- Address: ${address}`,
    `Our goal is to give you a thorough, honest assessment of what your carpets need and what it will cost — no pressure, no surprises. We take pride in treating every home like our own.`,
    `If anything changes or you have questions before we arrive, please text us at (719) 249-8791 and we'll help.`,
    `We'll see you soon!\n\nWith appreciation,\nThe Sasquatch Carpet Cleaning Team`,
  ].join('\n\n')
}

function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`
}

/**
 * Where the customer-facing accept link points. Must resolve to sightings.*,
 * not www — app routes 404 on the marketing domain.
 */
function publicSiteOrigin(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    request.nextUrl.origin
  ).replace(/\/+$/, '')
}

function buildQuoteBody(params: {
  firstName: string
  fullName: string
  address: string
  lineItems: Array<{
    name: string
    qty: number | null
    unitPrice: number
    lineTotal: number
    notes: string | null
    unit: string | null
  }>
  total: number
}): string {
  const { firstName, address, lineItems, total } = params
  const greeting = firstName || 'there'

  const lineDescriptions = lineItems
    .map((item) => {
      // Use the same unit helpers the estimate editor uses. Matching the unit
      // strings by hand here meant 'per_sq_ft' and 'per_linear_ft' — almost
      // every measured item in the catalog — fell through to the multiplier
      // branch, so a commercial quote read "×2600 × $0.35" instead of
      // "2600 sqft × $0.35".
      const qtyLabel = isAreaUnit(item.unit)
        ? `${item.qty ?? 0} sqft`
        : isLinearUnit(item.unit)
          ? `${item.qty ?? 0} linear ft`
          : item.qty && item.qty !== 1
            ? `×${item.qty}`
            : null
      const pricePart = qtyLabel
        ? `${qtyLabel} × ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`
        : formatCurrency(item.lineTotal)
      return `- ${item.name}: ${pricePart}${item.notes ? `\n  (${item.notes})` : ''}`
    })
    .join('\n')

  return [
    `Hi ${greeting},`,
    `Thank you for letting us visit your property at ${address}. Based on what we measured and assessed during our walk-through, here is your personalized estimate from Sasquatch Carpet Cleaning:`,
    `${lineDescriptions}\n\nEstimated Total: ${formatCurrency(total)}`,
    `This estimate reflects our standard pricing for the areas and services listed above. All of our work is backed by our satisfaction guarantee — if it's not right, we'll make it right.`,
    `When you're ready to schedule the cleaning, tap the button below to accept this estimate and we'll get you on the calendar right away. You can also just reply to this email or text us at (719) 249-8791.`,
    `We look forward to making your carpets look and feel like new again. Thank you for considering Sasquatch Carpet Cleaning — we don't take that trust lightly.`,
    `Warm regards,\nThe Sasquatch Carpet Cleaning Team`,
  ].join('\n\n')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()
    const { id } = await params
    const body = await request.json()
    const emailType: EmailType =
      body.type === 'quote' ? 'quote' : 'booking_confirmation'

    // Load the estimate with customer, address, and line items
    const { data: estimate, error: estimateError } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        start_time,
        end_time,
        quoted_total,
        ops_customers!ops_appointments_customer_id_fkey (
          id, full_name, first_name, email, phone, email_opt_out
        ),
        ops_service_addresses (
          street_1, city, state, zip_code
        ),
        ops_appointment_line_items (
          name_snapshot,
          quantity,
          unit_price,
          line_total,
          notes,
          pricing_unit_snapshot
        )
      `,
      )
      .eq('id', id)
      .eq('kind', 'estimate')
      .single()

    if (estimateError || !estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
    }

    const customer = Array.isArray(estimate.ops_customers)
      ? estimate.ops_customers[0]
      : estimate.ops_customers
    const addr = Array.isArray(estimate.ops_service_addresses)
      ? estimate.ops_service_addresses[0]
      : estimate.ops_service_addresses

    if (!customer?.email) {
      return NextResponse.json(
        { error: 'Customer has no email address — add one first.' },
        { status: 400 },
      )
    }

    if (
      customer.email_opt_out === true ||
      (customer.phone && (await isBlacklisted(customer.phone)))
    ) {
      return NextResponse.json(
        { error: 'Customer is suppressed from email communications.' },
        { status: 409 },
      )
    }

    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) {
      return NextResponse.json(
        { error: 'Email service not configured' },
        { status: 500 },
      )
    }
    const resend = new Resend(resendKey)

    const fromEmail =
      process.env.OPS_FROM_EMAIL ||
      'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>'
    const bcc = process.env.OPS_EMAIL_BCC || undefined

    const firstName =
      customer.first_name || customer.full_name?.split(' ')[0] || ''
    const fullName = customer.full_name || firstName
    const addressLine = addr
      ? `${addr.street_1}, ${addr.city}, ${addr.state} ${addr.zip_code}`
      : 'your property'

    const lineItems = (
      Array.isArray(estimate.ops_appointment_line_items)
        ? estimate.ops_appointment_line_items
        : []
    ).map((li) => ({
      name: li.name_snapshot,
      qty: li.quantity != null ? Number(li.quantity) : null,
      unitPrice: Number(li.unit_price ?? 0),
      lineTotal: Number(li.line_total ?? 0),
      notes: li.notes || null,
      unit: li.pricing_unit_snapshot || null,
    }))

    let subject: string
    let bodyText: string

    if (emailType === 'booking_confirmation') {
      subject = 'Your Free Estimate Appointment — Sasquatch Carpet Cleaning'
      bodyText = buildBookingConfirmationBody({
        firstName,
        fullName,
        date: toLocalDate(estimate.appointment_date),
        startTime: toLocalTime(estimate.start_time),
        endTime: toLocalTime(estimate.end_time),
        address: addressLine,
      })
    } else {
      subject = 'Your Estimate from Sasquatch Carpet Cleaning'
      bodyText = buildQuoteBody({
        firstName,
        fullName,
        address: addressLine,
        lineItems,
        total: Number(estimate.quoted_total ?? 0),
      })
    }

    const html = buildEmailHtml(bodyText, emailType, {
      cta:
        emailType === 'quote'
          ? {
              label: 'Accept this estimate',
              url: buildEstimateDecisionUrl(
                publicSiteOrigin(request),
                createEstimateDecisionToken({ estimateId: id }),
              ),
            }
          : null,
    })

    const { data: sent, error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: customer.email,
      bcc,
      subject,
      html,
    })

    if (sendError) {
      console.error('[estimates/send-email] Resend error:', sendError)
      return NextResponse.json(
        { error: sendError.message || 'Failed to send email' },
        { status: 500 },
      )
    }

    // Log to ops_email_log so it appears in the email outbox
    await supabase.from('ops_email_log').insert({
      appointment_id: id,
      customer_id: customer.id,
      template_key: emailType,
      to_email: customer.email,
      subject,
      body_text: bodyText,
      resend_id: (sent as { id?: string } | null)?.id ?? null,
    })

    // Mark the estimate status as 'sent' when a quote email goes out
    if (emailType === 'quote') {
      await supabase
        .from('ops_appointments')
        .update({
          estimate_status: 'sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('kind', 'estimate')
    }

    return NextResponse.json({ success: true, email_type: emailType })
  } catch (error) {
    console.error('[estimates/send-email] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send email',
      },
      { status: 500 },
    )
  }
}
