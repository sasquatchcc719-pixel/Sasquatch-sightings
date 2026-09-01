import { NextRequest, NextResponse } from 'next/server'
import {
  buildSquarePaymentPushContent,
  buildSquarePaymentTelegramMessage,
  parseCompletedSquarePayment,
  squarePaymentPushIdempotencyKey,
  verifySquareWebhookSignature,
} from '@/lib/payments/square-webhook'
import { handleRestorationFinalPayment } from '@/lib/payments/restoration-webhook'
import { sendOneSignalToExternalIds } from '@/lib/onesignal'
import { sendTelegramNotification } from '@/lib/telegram'
import { createAdminClient } from '@/supabase/server'

type CustomerRow = {
  business_name?: string | null
  full_name?: string | null
}

type AppointmentRow = {
  id: string
  assigned_staff_user_id?: string | null
  ops_customers?: CustomerRow | CustomerRow[] | null
}

type InvoiceRow = {
  id: string
  invoice_number: number | null
  total: number | string | null
  square_payment_id: string | null
  square_payment_link_cents: number | null
  ops_appointments?: AppointmentRow | AppointmentRow[] | null
}

function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] || null : value
}

function appOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://sightings.sasquatchcarpet.com'
  ).replace(/\/+$/, '')
}

function squarePaymentPushRecipientIds(): string[] {
  return Array.from(
    new Set(
      (process.env.SQUARE_PAYMENT_PUSH_RECIPIENT_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  )
}

/**
 * Decide which opted-in devices get the Square payment PUSH for this job.
 *
 * The push must only reach the technician who actually worked the job — a tech
 * should not be buzzed for another person's payment (e.g. David getting pushes
 * for Charles's jobs). Telegram delivery to the owner is separate and unchanged.
 *
 * Recipient IDs in SQUARE_PAYMENT_PUSH_RECIPIENT_IDS are Sightings auth user_ids
 * (OneSignal external_ids); `assigned_staff_user_id` is a staff_users.id, so we
 * resolve it to its user_id and keep only the recipient that matches.
 */
async function pushRecipientsForAssignedTech(
  supabase: ReturnType<typeof createAdminClient>,
  assignedStaffUserId: string | null | undefined,
): Promise<string[]> {
  const allowlist = squarePaymentPushRecipientIds()
  if (allowlist.length === 0) return []
  // No assigned tech → push to nobody. The owner still gets the Telegram alert.
  if (!assignedStaffUserId) return []

  const { data: staff } = await supabase
    .from('staff_users')
    .select('user_id')
    .or(`id.eq.${assignedStaffUserId},user_id.eq.${assignedStaffUserId}`)
    .limit(1)
    .maybeSingle()
  const assignedUserId = (staff?.user_id as string | null | undefined) || null
  if (!assignedUserId) return []

  return allowlist.filter((id) => id === assignedUserId)
}

async function releaseTelegramClaim(invoiceId: string, claimedAt: string) {
  const supabase = createAdminClient()
  await supabase
    .from('ops_invoices')
    .update({ square_telegram_notification_claimed_at: null })
    .eq('id', invoiceId)
    .eq('square_telegram_notification_claimed_at', claimedAt)
}

export async function POST(request: NextRequest) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
  if (!signatureKey || !notificationUrl) {
    console.error('[webhooks/square] Webhook verification is not configured')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 503 },
    )
  }

  const body = await request.text()
  const signature = request.headers.get('x-square-hmacsha256-signature') || ''
  if (
    !signature ||
    !verifySquareWebhookSignature({
      body,
      notificationUrl,
      signature,
      signatureKey,
    })
  ) {
    console.warn('[webhooks/square] Rejected invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const payment = parseCompletedSquarePayment(payload)
  if (!payment) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  try {
    const supabase = createAdminClient()
    const { data, error: invoiceError } = await supabase
      .from('ops_invoices')
      .select(
        `
          id,
          invoice_number,
          total,
          square_payment_id,
          square_payment_link_cents,
          ops_appointments (
            id,
            assigned_staff_user_id,
            ops_customers!ops_appointments_customer_id_fkey (
              full_name,
              business_name
            )
          )
        `,
      )
      .eq('square_order_id', payment.orderId)
      .maybeSingle()

    if (invoiceError) throw invoiceError
    if (!data) {
      const restoration = await handleRestorationFinalPayment(supabase, payment)
      if (restoration.outcome !== 'unmatched') {
        return NextResponse.json({
          ok: true,
          ...(restoration.outcome === 'recorded'
            ? { restoration_project_id: restoration.projectId }
            : { ignored: restoration.outcome }),
        })
      }
      // The Square account also emits events for POS and Dashboard payments.
      // Only links created by Sightings have a stored order correlation.
      return NextResponse.json({ ok: true, ignored: 'unmatched_order' })
    }

    const invoice = data as InvoiceRow
    if (
      invoice.square_payment_id &&
      invoice.square_payment_id !== payment.paymentId
    ) {
      console.error(
        `[webhooks/square] Invoice ${invoice.id} already has a different Square payment`,
      )
      return NextResponse.json({ ok: true, ignored: 'already_paid' })
    }

    const invoiceCents = Math.round(Number(invoice.total || 0) * 100)
    const linkCents = Number(invoice.square_payment_link_cents || 0)
    const expectedCents = Math.max(invoiceCents, linkCents)
    if (
      payment.currency !== 'USD' ||
      expectedCents <= 0 ||
      payment.amountCents < expectedCents
    ) {
      console.error(
        `[webhooks/square] Payment ${payment.paymentId} did not cover invoice ${invoice.id}`,
      )
      return NextResponse.json({ ok: true, ignored: 'amount_mismatch' })
    }

    const nowIso = new Date().toISOString()
    const paymentUpdate = {
      status: 'paid',
      payment_status: 'paid',
      payment_method: 'square',
      square_payment_id: payment.paymentId,
      square_payment_event_id: payment.eventId,
      square_paid_cents: payment.amountCents,
      square_paid_at: payment.paidAt,
      updated_at: nowIso,
    }
    const updateQuery = supabase
      .from('ops_invoices')
      .update(paymentUpdate)
      .eq('id', invoice.id)
    const { error: updateError } = invoice.square_payment_id
      ? await updateQuery.eq('square_payment_id', payment.paymentId)
      : await updateQuery.is('square_payment_id', null)
    if (updateError) throw updateError

    const appointment = unwrapRelation(invoice.ops_appointments)
    if (appointment?.id) {
      const { error: appointmentError } = await supabase
        .from('ops_appointments')
        .update({ payment_status: 'paid', updated_at: nowIso })
        .eq('id', appointment.id)
      if (appointmentError) throw appointmentError
    }

    // Clear an abandoned claim so Square's retry can recover a Telegram send
    // interrupted before it recorded success.
    const staleClaim = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await supabase
      .from('ops_invoices')
      .update({ square_telegram_notification_claimed_at: null })
      .eq('id', invoice.id)
      .is('square_telegram_notified_at', null)
      .lt('square_telegram_notification_claimed_at', staleClaim)

    const claimedAt = new Date().toISOString()
    const { data: claimed, error: claimError } = await supabase
      .from('ops_invoices')
      .update({ square_telegram_notification_claimed_at: claimedAt })
      .eq('id', invoice.id)
      .eq('square_payment_id', payment.paymentId)
      .is('square_telegram_notified_at', null)
      .is('square_telegram_notification_claimed_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError

    if (!claimed) {
      const { data: notificationState, error: stateError } = await supabase
        .from('ops_invoices')
        .select('square_telegram_notified_at')
        .eq('id', invoice.id)
        .single()
      if (stateError) throw stateError
      if (notificationState.square_telegram_notified_at) {
        return NextResponse.json({ ok: true, duplicate: true })
      }
      return NextResponse.json(
        { error: 'Telegram notification is already processing' },
        { status: 503 },
      )
    }

    const customer = unwrapRelation(appointment?.ops_customers)
    const customerName =
      customer?.business_name || customer?.full_name || 'Customer'
    const invoiceNumber = invoice.invoice_number || invoice.id.slice(0, 8)
    const invoiceUrl = `${appOrigin()}/admin/operations/invoices/${invoice.id}`
    const message = buildSquarePaymentTelegramMessage({
      amountCents: payment.amountCents,
      customerName,
      invoiceNumber,
      invoiceUrl,
      paidAt: payment.paidAt,
    })

    const pushRecipients = await pushRecipientsForAssignedTech(
      supabase,
      appointment?.assigned_staff_user_id,
    )
    if (pushRecipients.length > 0) {
      const pushResult = await sendOneSignalToExternalIds({
        externalIds: pushRecipients,
        heading: 'Square payment received',
        content: buildSquarePaymentPushContent({
          amountCents: payment.amountCents,
          customerName,
          invoiceNumber,
        }),
        data: {
          type: 'square_payment_received',
          invoice_id: invoice.id,
          payment_id: payment.paymentId,
        },
        idempotencyKey: squarePaymentPushIdempotencyKey(payment.eventId),
        url: `${appOrigin()}/tech`,
      })
      if (!pushResult) {
        console.error(
          `[webhooks/square] Push notification was not delivered for invoice ${invoice.id}`,
        )
      }
    }

    const telegramSent = await sendTelegramNotification(message, {
      disablePreview: true,
    })
    if (!telegramSent) {
      await releaseTelegramClaim(invoice.id, claimedAt)
      return NextResponse.json(
        { error: 'Telegram notification failed' },
        { status: 503 },
      )
    }

    const { error: notifiedError } = await supabase
      .from('ops_invoices')
      .update({
        square_telegram_notification_claimed_at: null,
        square_telegram_notified_at: new Date().toISOString(),
      })
      .eq('id', invoice.id)
      .eq('square_telegram_notification_claimed_at', claimedAt)
    if (notifiedError) throw notifiedError

    return NextResponse.json({ ok: true, invoice_id: invoice.id })
  } catch (error) {
    console.error('[webhooks/square] Processing failed:', error)
    return NextResponse.json(
      { error: 'Square webhook processing failed' },
      { status: 500 },
    )
  }
}
