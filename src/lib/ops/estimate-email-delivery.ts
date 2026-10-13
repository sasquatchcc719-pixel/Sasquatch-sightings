import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { isBlacklisted } from '@/lib/blacklist'
import { buildEmailHtml } from '@/lib/ops/communications'
import {
  buildEstimateDecisionUrl,
  createEstimateDecisionToken,
} from '@/lib/ops/estimate-decision-token'
import { isAreaUnit, isLinearUnit } from '@/lib/ops/estimates'

export function estimateEmailFingerprint(params: {
  estimateId: string
  recipient: string
  subject: string
  bodyText: string
}) {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex')
}

function formatCurrency(n: number): string {
  return n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`
}

export function buildEstimateQuoteBody(params: {
  firstName: string
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
  const greeting = params.firstName || 'there'
  const lineDescriptions = params.lineItems
    .map((item) => {
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
    `Thank you for letting us visit your property at ${params.address}. Based on what we measured and assessed during our walk-through, here is your personalized estimate from Sasquatch Carpet Cleaning:`,
    `${lineDescriptions}\n\nEstimated Total: ${formatCurrency(params.total)}`,
    `This estimate reflects our standard pricing for the areas and services listed above. All of our work is backed by our satisfaction guarantee — if it's not right, we'll make it right.`,
    `When you're ready to schedule the cleaning, tap the button below to accept this estimate and we'll get you on the calendar right away. You can also just reply to this email or text us at (719) 249-8791.`,
    `We look forward to making your carpets look and feel like new again. Thank you for considering Sasquatch Carpet Cleaning — we don't take that trust lightly.`,
    `Warm regards,\nThe Sasquatch Carpet Cleaning Team`,
  ].join('\n\n')
}

export class EstimateDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type PreparedEstimateQuote = {
  estimate_id: string
  customer_id: string
  recipient: string
  subject: string
  body_text: string
  html: string
  total: number
  previous_status: string
  previous_status_raw: string | null
  estimate_updated_at: string
  needs_reopen: boolean
  preview_fingerprint: string
  decision_expires_at: string
}

export async function prepareEstimateQuote(params: {
  supabase: SupabaseClient
  estimateId: string
  publicOrigin: string
  decisionExpiresAt: string
  isPhoneBlacklisted?: (phone: string) => Promise<boolean>
}): Promise<PreparedEstimateQuote> {
  const { data: estimate, error } = await params.supabase
    .from('ops_appointments')
    .select(
      `id, quoted_total, estimate_status, converted_appointment_id, updated_at,
       ops_customers!ops_appointments_customer_id_fkey(id, full_name, first_name, email, phone, email_opt_out),
       ops_service_addresses(street_1, city, state, zip_code),
       ops_appointment_line_items(name_snapshot, quantity, unit_price, line_total, notes, pricing_unit_snapshot)`,
    )
    .eq('id', params.estimateId)
    .eq('kind', 'estimate')
    .maybeSingle()
  if (error) throw error
  if (!estimate) throw new EstimateDeliveryError('Estimate not found', 404)

  const previousStatus = estimate.estimate_status || 'draft'
  if (estimate.converted_appointment_id || previousStatus === 'converted') {
    throw new EstimateDeliveryError(
      'This estimate has already been converted to a job and cannot be reopened or resent.',
      409,
    )
  }
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
    (customer.phone &&
      (await (params.isPhoneBlacklisted || isBlacklisted)(customer.phone)))
  ) {
    throw new EstimateDeliveryError(
      'Customer is suppressed from email communications.',
      409,
    )
  }

  const recipient = customer.email.trim()
  const firstName =
    customer.first_name || customer.full_name?.split(' ')[0] || ''
  const addressLine = address
    ? `${address.street_1}, ${address.city}, ${address.state} ${address.zip_code}`
    : 'your property'
  const lineItems = (estimate.ops_appointment_line_items || []).map((line) => ({
    name: line.name_snapshot,
    qty: line.quantity == null ? null : Number(line.quantity),
    unitPrice: Number(line.unit_price || 0),
    lineTotal: Number(line.line_total || 0),
    notes: line.notes || null,
    unit: line.pricing_unit_snapshot || null,
  }))
  const total = Number(estimate.quoted_total || 0)
  const subject = 'Your Estimate from Sasquatch Carpet Cleaning'
  const bodyText = buildEstimateQuoteBody({
    firstName,
    address: addressLine,
    lineItems,
    total,
  })
  const decisionUrl = buildEstimateDecisionUrl(
    params.publicOrigin.replace(/\/+$/, ''),
    createEstimateDecisionToken({
      estimateId: estimate.id,
      expiresAt: new Date(params.decisionExpiresAt),
    }),
  )
  const html = buildEmailHtml(bodyText, 'quote', {
    cta: { label: 'Accept this estimate', url: decisionUrl },
  })
  return {
    estimate_id: estimate.id,
    customer_id: customer.id,
    recipient,
    subject,
    body_text: bodyText,
    html,
    total,
    previous_status: previousStatus,
    previous_status_raw: estimate.estimate_status,
    estimate_updated_at: estimate.updated_at,
    needs_reopen:
      previousStatus === 'accepted' || previousStatus === 'declined',
    preview_fingerprint: estimateEmailFingerprint({
      estimateId: estimate.id,
      recipient: recipient.toLowerCase(),
      subject,
      bodyText,
    }),
    decision_expires_at: params.decisionExpiresAt,
  }
}

type SendEmail = (params: {
  from: string
  to: string
  bcc?: string
  subject: string
  html: string
  idempotencyKey: string
}) => Promise<{ id: string | null }>

async function resendEmail(params: Parameters<SendEmail>[0]) {
  if (!process.env.RESEND_API_KEY) {
    throw new EstimateDeliveryError('Email service not configured', 500)
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send(
    {
      from: params.from,
      to: params.to,
      bcc: params.bcc,
      subject: params.subject,
      html: params.html,
    },
    { idempotencyKey: params.idempotencyKey },
  )
  if (error) throw new Error(error.message || 'Failed to send email')
  return { id: (data as { id?: string } | null)?.id || null }
}

export async function deliverPreparedEstimateQuote(params: {
  supabase: SupabaseClient
  prepared: PreparedEstimateQuote
  actorId: string
  reopen: boolean
  reason?: string | null
  providerIdempotencyKey: string
  sendEmail?: SendEmail
}) {
  if (params.prepared.needs_reopen && !params.reopen) {
    throw new EstimateDeliveryError(
      'Use Reopen & resend to request a new decision on this estimate.',
      409,
    )
  }
  const reason = params.reason?.trim() || ''
  if (params.prepared.needs_reopen && (!reason || reason.length > 1000)) {
    throw new EstimateDeliveryError(
      'Enter a reason for reopening (up to 1,000 characters).',
      400,
    )
  }
  const sendEmail = params.sendEmail || resendEmail
  const sent = await sendEmail({
    from:
      process.env.OPS_FROM_EMAIL ||
      'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
    to: params.prepared.recipient,
    bcc: process.env.OPS_EMAIL_BCC || undefined,
    subject: params.prepared.subject,
    html: params.prepared.html,
    idempotencyKey: params.providerIdempotencyKey,
  })

  const warnings: string[] = []
  const { error: logError } = await params.supabase
    .from('ops_email_log')
    .insert({
      appointment_id: params.prepared.estimate_id,
      customer_id: params.prepared.customer_id,
      template_key: 'quote',
      to_email: params.prepared.recipient,
      subject: params.prepared.subject,
      body_text: params.prepared.body_text,
      resend_id: sent.id,
    })
  if (logError) {
    console.error('[estimate-delivery] email history failed:', logError)
    warnings.push(
      'Email was sent, but email history could not be saved. Check the email outbox before resending.',
    )
  }

  let update = params.supabase
    .from('ops_appointments')
    .update({ estimate_status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', params.prepared.estimate_id)
    .eq('kind', 'estimate')
    .is('converted_appointment_id', null)
    .eq('updated_at', params.prepared.estimate_updated_at)
  update =
    params.prepared.previous_status_raw === null
      ? update.is('estimate_status', null)
      : update.eq('estimate_status', params.prepared.previous_status_raw)
  const { data: changed, error: statusError } = await update
    .select('id')
    .maybeSingle()
  if (statusError || !changed) {
    console.error('[estimate-delivery] status not updated:', statusError)
    warnings.push(
      'Email was sent, but the estimate changed during sending or its status could not be updated. Refresh it; do not resend just to repair status.',
    )
  } else if (params.prepared.previous_status !== 'sent') {
    const { error: auditError } = await params.supabase
      .from('ops_appointment_status_events')
      .insert({
        appointment_id: params.prepared.estimate_id,
        from_status: params.prepared.previous_status,
        to_status: 'sent',
        changed_by: params.actorId,
        notes: params.prepared.needs_reopen
          ? `Estimate reopened and emailed to ${params.prepared.recipient}. Reason: ${reason}`
          : `Estimate emailed to ${params.prepared.recipient}`,
      })
    if (auditError) {
      console.error('[estimate-delivery] status history failed:', auditError)
      warnings.push(
        'Email was sent and status updated, but status history could not be saved.',
      )
    }
  }

  return {
    success: true,
    email_type: 'quote' as const,
    to_email: params.prepared.recipient,
    provider_message_id: sent.id,
    warning: warnings.join(' ') || null,
  }
}
