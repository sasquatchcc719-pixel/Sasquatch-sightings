import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { requireAnyRole } from '@/lib/auth'
import { isBlacklisted } from '@/lib/blacklist'
import { createAdminClient } from '@/supabase/server'
import { buildEmailHtml } from '@/lib/ops/communications'
import { isDeliverableCustomerEmail } from '@/lib/ops/email'
import { opsEmailBcc } from '@/lib/ops/email-bcc'
import {
  buildResidentialEstimateEmail,
  type ResidentialEstimateLine,
} from '@/lib/ops/residential-estimate-email'
import {
  computePromoDiscountAmount,
  computeTieredDiscountAmount,
} from '@/lib/promo-discount'

type IncomingLine = {
  service_catalog_item_id?: string | null
  name_snapshot?: string
  quantity?: number | string
  unit_price?: number | string | null
}

class EstimateRequestError extends Error {}

function estimateFingerprint(
  recipient: string,
  draft: { subject: string; body_text: string },
  customerId: string | null,
) {
  return createHash('sha256')
    .update(JSON.stringify([recipient, draft, customerId]))
    .digest('hex')
}

export async function POST(request: NextRequest) {
  let access
  try {
    access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
  } catch {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    if (body.action !== 'preview' && body.action !== 'send') {
      throw new EstimateRequestError('Choose preview or send.')
    }
    const supabase = createAdminClient()
    let sendKey = ''
    let logId = ''
    if (body.action === 'send') {
      const requestId = body.request_id
      const requestedAt =
        typeof requestId === 'string' ? Number(requestId.split('-')[0]) : NaN
      const expiredResponse = () =>
        NextResponse.json(
          {
            error: 'This send preview has expired. Preview the estimate again.',
            code: 'request_expired',
          },
          { status: 400 },
        )
      if (
        typeof requestId !== 'string' ||
        !/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          requestId,
        )
      )
        return expiredResponse()
      sendKey = `residential-estimate/${access.id}/${requestId}`
      const hash = createHash('sha256')
        .update(sendKey)
        .digest('hex')
        .slice(0, 32)
      logId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
      const { data: previous, error } = await supabase
        .from('ops_email_log')
        .select('to_email, subject, body_text, customer_id, resend_id')
        .eq('id', logId)
        .eq('template_key', 'residential_estimate')
        .eq('status', 'sent')
        .maybeSingle()
      if (error) throw error
      // A saved receipt proves this snapshot already went out, even if its
      // coupon, customer record, or catalog has changed since the first send.
      if (previous?.resend_id && previous.subject && previous.body_text) {
        const previousFingerprint = estimateFingerprint(
          previous.to_email,
          {
            subject: previous.subject,
            body_text: previous.body_text,
          },
          previous.customer_id,
        )
        if (body.expected_fingerprint !== previousFingerprint) {
          return NextResponse.json(
            {
              error:
                'This send request was already used for a different estimate. Preview the revised estimate again.',
              code: 'request_reused',
            },
            { status: 409 },
          )
        }
        return NextResponse.json({
          success: true,
          to_email: previous.to_email,
          warning: null,
        })
      }
      if (
        requestedAt < Date.now() - 86400000 ||
        requestedAt > Date.now() + 300000
      ) {
        return expiredResponse()
      }
    }
    const recipient = String(body.recipient_email || '')
      .trim()
      .toLowerCase()
    if (
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) ||
      !isDeliverableCustomerEmail(recipient)
    ) {
      throw new EstimateRequestError('Enter a valid customer email address.')
    }
    const rawLines: IncomingLine[] = Array.isArray(body.line_items)
      ? body.line_items
      : []
    if (!rawLines.length) {
      throw new EstimateRequestError(
        'Add at least one service to the estimate.',
      )
    }

    const customerId = body.customer_id || body.customer?.id || null
    const customerFields = 'id, first_name, email, phone, email_opt_out'
    const { data: recipientCustomers, error: recipientError } = await supabase
      .from('ops_customers')
      .select(customerFields)
      .ilike('email', recipient.replace(/[\\%_]/g, '\\$&'))
    if (recipientError) throw recipientError
    let selectedCustomer = null
    if (customerId) {
      const { data, error } = await supabase
        .from('ops_customers')
        .select(customerFields)
        .eq('id', customerId)
        .maybeSingle()
      if (error) throw error
      if (!data)
        throw new EstimateRequestError('Selected customer was not found.')
      selectedCustomer = data
    }
    const customers = [selectedCustomer, ...(recipientCustomers || [])].filter(
      (customer) => customer !== null,
    )
    const phones = new Set<string>(
      customers.map((customer) => customer.phone).filter(Boolean),
    )
    if (body.customer?.phone) phones.add(String(body.customer.phone))
    if (
      customers.some((customer) => customer.email_opt_out === true) ||
      (
        await Promise.all([...phones].map((phone) => isBlacklisted(phone)))
      ).some(Boolean)
    ) {
      return NextResponse.json(
        { error: 'Customer is suppressed from email communications.' },
        { status: 409 },
      )
    }

    const serviceIds = rawLines
      .map((line) => line?.service_catalog_item_id)
      .filter((id): id is string => Boolean(id))
    const { data: services, error: servicesError } = serviceIds.length
      ? await supabase
          .from('service_catalog_items')
          .select('id, name, base_price, pricing_unit')
          .in('id', serviceIds)
      : { data: [], error: null }
    if (servicesError) throw servicesError
    const serviceMap = new Map(
      (services || []).map((service) => [service.id, service]),
    )
    const lineItems: ResidentialEstimateLine[] = rawLines.map((line) => {
      const service = line?.service_catalog_item_id
        ? serviceMap.get(line.service_catalog_item_id)
        : null
      const quantity = Number(line?.quantity ?? 1)
      const price = line?.unit_price ?? service?.base_price
      const unitPrice = Number(price)
      const name = String(line?.name_snapshot || service?.name || '').trim()
      if (
        !name ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        price === undefined ||
        price === null ||
        price === '' ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0 ||
        !Number.isFinite(quantity * unitPrice)
      ) {
        throw new EstimateRequestError(
          'Every service needs a name, positive quantity, and valid price.',
        )
      }
      return {
        name,
        quantity,
        unit_price: unitPrice,
        line_total: Number((quantity * unitPrice).toFixed(2)),
        pricing_unit: service?.pricing_unit || null,
      }
    })
    const subtotal = Number(
      lineItems.reduce((sum, line) => sum + line.line_total, 0).toFixed(2),
    )
    const promoCode =
      String(body.promo_code || '')
        .trim()
        .toUpperCase() || null
    let discountAmount = Number(body.discount_amount || 0)
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      throw new EstimateRequestError('Enter a valid discount amount.')
    }
    if (promoCode) {
      const { data: promo, error } = await supabase
        .from('promo_codes')
        .select(
          'id, code, discount_type, discount_amount, expires_at, max_uses, use_count',
        )
        .eq('code', promoCode)
        .eq('active', true)
        .maybeSingle()
      if (error) throw error
      if (!promo)
        throw new EstimateRequestError(
          `Coupon code "${promoCode}" is not active.`,
        )
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        throw new EstimateRequestError(
          `Coupon code "${promoCode}" has expired.`,
        )
      }
      if (promo.max_uses !== null && promo.use_count >= promo.max_uses) {
        throw new EstimateRequestError(
          `Coupon code "${promoCode}" has reached its usage limit.`,
        )
      }
      if (promo.discount_type === 'tiered') {
        const { data: tiers, error: tierError } = await supabase
          .from('promo_code_tiers')
          .select('min_spend, discount_amount')
          .eq('promo_code_id', promo.id)
        if (tierError) throw tierError
        discountAmount = computeTieredDiscountAmount(
          subtotal,
          (tiers || []).map((tier) => ({
            min_spend: Number(tier.min_spend),
            discount_amount: Number(tier.discount_amount),
          })),
        )
      } else {
        discountAmount = computePromoDiscountAmount(
          subtotal,
          promo.discount_type,
          Number(promo.discount_amount),
        )
      }
      if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
        throw new EstimateRequestError(
          `The current $${subtotal.toFixed(2)} subtotal does not qualify for coupon code "${promoCode}".`,
        )
      }
    }
    discountAmount = Number(Math.min(subtotal, discountAmount).toFixed(2))
    const total = Number(Math.max(0, subtotal - discountAmount).toFixed(2))

    let address = body.address
    if (address?.id) {
      let query = supabase
        .from('ops_service_addresses')
        .select('street_1, street_2, city, state, zip_code')
        .eq('id', address.id)
      if (customerId) query = query.eq('customer_id', customerId)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data)
        throw new EstimateRequestError(
          'Selected service address was not found.',
        )
      address = data
    }
    const addressLine =
      address?.street_1 && address?.city && address?.state && address?.zip_code
        ? `${address.street_1}${address.street_2 ? `, ${address.street_2}` : ''}, ${address.city}, ${address.state} ${address.zip_code}`
        : undefined
    const customerForLog = selectedCustomer || recipientCustomers?.[0] || null
    const draft = buildResidentialEstimateEmail({
      firstName: String(
        body.customer?.first_name || selectedCustomer?.first_name || '',
      ).trim(),
      address: addressLine,
      lineItems,
      subtotal,
      discountAmount,
      promoCode,
      total,
    })
    const fingerprint = estimateFingerprint(
      recipient,
      draft,
      customerForLog?.id || null,
    )
    const preview = {
      to_email: recipient,
      ...draft,
      html: buildEmailHtml(draft.body_text, 'residential_estimate', {
        cta: null,
      }),
      subtotal,
      discount_amount: discountAmount,
      total,
      preview_fingerprint: fingerprint,
    }
    if (body.action === 'preview') return NextResponse.json(preview)
    if (body.expected_fingerprint !== fingerprint) {
      return NextResponse.json(
        {
          error:
            'The estimate or recipient changed. Preview it again before sending.',
        },
        { status: 409 },
      )
    }
    if (!process.env.RESEND_API_KEY)
      throw new Error('Email service not configured')
    const { data: sent, error: sendError } = await new Resend(
      process.env.RESEND_API_KEY,
    ).emails.send(
      {
        from:
          process.env.OPS_FROM_EMAIL ||
          'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>',
        to: recipient,
        bcc: opsEmailBcc(),
        subject: draft.subject,
        html: preview.html,
        text: draft.body_text,
      },
      { idempotencyKey: sendKey },
    )
    if (sendError) throw new Error(sendError.message || 'Failed to send email')
    if (!sent?.id)
      throw new Error('Email provider did not confirm delivery acceptance')

    let warning: string | null = null
    try {
      // A deterministic log ID makes provider retries produce one outbox entry.
      const { error } = await supabase.from('ops_email_log').upsert(
        {
          id: logId,
          appointment_id: null,
          customer_id: customerForLog?.id || null,
          template_key: 'residential_estimate',
          to_email: recipient,
          subject: draft.subject,
          body_text: draft.body_text,
          resend_id: sent.id,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      )
      if (error) throw error
    } catch (error) {
      console.error('[residential-estimate] Email history error:', error)
      warning =
        'Email was sent, but email history could not be saved. Check the email outbox before resending.'
    }
    return NextResponse.json({ success: true, to_email: recipient, warning })
  } catch (error) {
    if (error instanceof EstimateRequestError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[residential-estimate] Error:', error)
    return NextResponse.json(
      { error: 'Unable to complete the estimate email. Please try again.' },
      { status: 500 },
    )
  }
}
