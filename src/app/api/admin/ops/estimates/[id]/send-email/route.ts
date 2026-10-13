import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { isBlacklisted } from '@/lib/blacklist'
import { buildEmailHtml } from '@/lib/ops/communications'
import {
  deliverPreparedEstimateQuote,
  EstimateDeliveryError,
  prepareEstimateQuote,
} from '@/lib/ops/estimate-email-delivery'
import { createAdminClient } from '@/supabase/server'

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
  date: string
  startTime: string
  endTime: string
  address: string
}): string {
  const greeting = params.firstName || 'there'
  return [
    `Hi ${greeting},`,
    `Thank you so much for reaching out to Sasquatch Carpet Cleaning — we truly appreciate the opportunity to earn your business.`,
    `We're looking forward to visiting your property to take a look at everything and provide you with a detailed, no-obligation estimate. Here are your appointment details:\n\n- Date: ${params.date}\n- Time: ${params.startTime} – ${params.endTime}\n- Address: ${params.address}`,
    `Our goal is to give you a thorough, honest assessment of what your carpets need and what it will cost — no pressure, no surprises. We take pride in treating every home like our own.`,
    `If anything changes or you have questions before we arrive, please text us at (719) 249-8791 and we'll help.`,
    `We'll see you soon!\n\nWith appreciation,\nThe Sasquatch Carpet Cleaning Team`,
  ].join('\n\n')
}

function publicSiteOrigin(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    request.nextUrl.origin
  ).replace(/\/+$/, '')
}

function parseRequestId(value: unknown) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !/^\d{13}-[0-9a-f-]{36}$/i.test(value)) {
    throw new EstimateDeliveryError(
      'This send confirmation has expired. Close it and review the estimate again.',
      400,
    )
  }
  const requestedAt = Number(value.split('-')[0])
  if (
    !Number.isFinite(requestedAt) ||
    requestedAt < Date.now() - 86400000 ||
    requestedAt > Date.now() + 300000
  ) {
    throw new EstimateDeliveryError(
      'This send confirmation has expired. Close it and review the estimate again.',
      400,
    )
  }
  return { value, requestedAt }
}

async function handleQuote(params: {
  request: NextRequest
  body: Record<string, unknown>
  estimateId: string
  actorId: string
}) {
  const requestId = parseRequestId(params.body.request_id)
  const decisionExpiresAt = new Date(
    (requestId?.requestedAt ?? Date.now()) + 30 * 86400000,
  ).toISOString()
  const supabase = createAdminClient()
  const prepared = await prepareEstimateQuote({
    supabase,
    estimateId: params.estimateId,
    publicOrigin: publicSiteOrigin(params.request),
    decisionExpiresAt,
  })

  if (
    params.body.expected_status !== undefined &&
    params.body.expected_status !== prepared.previous_status
  ) {
    throw new EstimateDeliveryError(
      'The estimate status changed. Refresh and review it before sending.',
      409,
    )
  }
  if (
    params.body.expected_total !== undefined &&
    Number(params.body.expected_total) !== prepared.total
  ) {
    throw new EstimateDeliveryError(
      'The estimate total changed. Refresh and review the saved pricing before sending.',
      409,
    )
  }
  if (
    params.body.expected_email !== undefined &&
    (typeof params.body.expected_email !== 'string' ||
      params.body.expected_email.trim().toLowerCase() !==
        prepared.recipient.toLowerCase())
  ) {
    throw new EstimateDeliveryError(
      'The saved customer email differs from the confirmation. Refresh and check the recipient before sending.',
      409,
    )
  }

  if (params.body.action === 'preview') {
    return NextResponse.json({
      to_email: prepared.recipient,
      subject: prepared.subject,
      body_text: prepared.body_text,
      html: prepared.html,
      total: prepared.total,
      preview_fingerprint: prepared.preview_fingerprint,
    })
  }
  if (
    requestId &&
    params.body.expected_fingerprint !== prepared.preview_fingerprint
  ) {
    throw new EstimateDeliveryError(
      'The recipient, line items, pricing, notes, or email language changed after review. Review the refreshed email before sending.',
      409,
    )
  }

  const result = await deliverPreparedEstimateQuote({
    supabase,
    prepared,
    actorId: params.actorId,
    reopen: params.body.reopen === true,
    reason:
      typeof params.body.reason === 'string' ? params.body.reason : undefined,
    providerIdempotencyKey: `estimate-quote/${params.estimateId}/${requestId?.value || randomUUID()}`,
  })
  return NextResponse.json(result)
}

async function handleBookingConfirmation(params: {
  estimateId: string
  body: Record<string, unknown>
  requestId: ReturnType<typeof parseRequestId>
}) {
  const supabase = createAdminClient()
  const { data: estimate, error } = await supabase
    .from('ops_appointments')
    .select(
      `id, appointment_date, start_time, end_time,
       ops_customers!ops_appointments_customer_id_fkey(id, full_name, first_name, email, phone, email_opt_out),
       ops_service_addresses(street_1, city, state, zip_code)`,
    )
    .eq('id', params.estimateId)
    .eq('kind', 'estimate')
    .maybeSingle()
  if (error) throw error
  if (!estimate) throw new EstimateDeliveryError('Estimate not found', 404)
  const customer = Array.isArray(estimate.ops_customers)
    ? estimate.ops_customers[0]
    : estimate.ops_customers
  const address = Array.isArray(estimate.ops_service_addresses)
    ? estimate.ops_service_addresses[0]
    : estimate.ops_service_addresses
  if (!customer?.email) {
    throw new EstimateDeliveryError(
      'Customer has no email address — add one first.',
      400,
    )
  }
  if (
    customer.email_opt_out === true ||
    (customer.phone && (await isBlacklisted(customer.phone)))
  ) {
    throw new EstimateDeliveryError(
      'Customer is suppressed from email communications.',
      409,
    )
  }
  if (
    params.body.expected_email !== undefined &&
    (typeof params.body.expected_email !== 'string' ||
      params.body.expected_email.trim().toLowerCase() !==
        customer.email.trim().toLowerCase())
  ) {
    throw new EstimateDeliveryError(
      'The saved customer email differs from the confirmation. Refresh and check the recipient before sending.',
      409,
    )
  }

  const addressLine = address
    ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
    : 'your property'
  const subject = 'Your Free Estimate Appointment — Sasquatch Carpet Cleaning'
  const bodyText = buildBookingConfirmationBody({
    firstName: customer.first_name || customer.full_name?.split(' ')[0] || '',
    date: toLocalDate(estimate.appointment_date),
    startTime: toLocalTime(estimate.start_time),
    endTime: toLocalTime(estimate.end_time),
    address: addressLine,
  })
  const html = buildEmailHtml(bodyText, 'booking_confirmation', { cta: null })
  if (!process.env.RESEND_API_KEY) {
    throw new EstimateDeliveryError('Email service not configured', 500)
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data: sent, error: sendError } = await resend.emails.send(
    {
      from:
        process.env.OPS_FROM_EMAIL ||
        'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
      to: customer.email,
      bcc: process.env.OPS_EMAIL_BCC || undefined,
      subject,
      html,
    },
    params.requestId
      ? {
          idempotencyKey: `estimate-booking_confirmation/${params.estimateId}/${params.requestId.value}`,
        }
      : undefined,
  )
  if (sendError) throw new Error(sendError.message || 'Failed to send email')

  const { error: logError } = await supabase.from('ops_email_log').insert({
    appointment_id: params.estimateId,
    customer_id: customer.id,
    template_key: 'booking_confirmation',
    to_email: customer.email,
    subject,
    body_text: bodyText,
    resend_id: (sent as { id?: string } | null)?.id || null,
  })
  return NextResponse.json({
    success: true,
    email_type: 'booking_confirmation' as const,
    to_email: customer.email,
    warning: logError
      ? 'Email was sent, but email history could not be saved. Check the email outbox before resending.'
      : null,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    const body = (await request.json()) as Record<string, unknown>
    const emailType: EmailType =
      body.type === 'quote' ? 'quote' : 'booking_confirmation'
    if (emailType === 'quote') {
      return await handleQuote({
        request,
        body,
        estimateId: id,
        actorId: access.id,
      })
    }
    return await handleBookingConfirmation({
      estimateId: id,
      body,
      requestId: parseRequestId(body.request_id),
    })
  } catch (error) {
    console.error('[estimates/send-email] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to send email',
      },
      { status: error instanceof EstimateDeliveryError ? error.status : 500 },
    )
  }
}
