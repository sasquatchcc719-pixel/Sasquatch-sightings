import { createHmac, timingSafeEqual } from 'node:crypto'

export type CompletedSquarePayment = {
  amountCents: number
  currency: string
  eventId: string
  orderId: string
  paidAt: string
  paymentId: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function verifySquareWebhookSignature(params: {
  body: string
  notificationUrl: string
  signature: string
  signatureKey: string
}): boolean {
  const expected = createHmac('sha256', params.signatureKey)
    .update(params.notificationUrl + params.body, 'utf8')
    .digest()

  let actual: Buffer
  try {
    actual = Buffer.from(params.signature, 'base64')
  } catch {
    return false
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function parseCompletedSquarePayment(
  payload: unknown,
): CompletedSquarePayment | null {
  const event = asRecord(payload)
  if (event?.type !== 'payment.updated') return null

  const eventId = nonEmptyString(event.event_id)
  const data = asRecord(event.data)
  const object = asRecord(data?.object)
  const payment = asRecord(object?.payment)
  const money = asRecord(payment?.amount_money)
  const paymentId = nonEmptyString(payment?.id)
  const orderId = nonEmptyString(payment?.order_id)
  const currency = nonEmptyString(money?.currency)
  const amountCents = Number(money?.amount)

  if (
    !eventId ||
    payment?.status !== 'COMPLETED' ||
    !paymentId ||
    !orderId ||
    !currency ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    return null
  }

  return {
    amountCents,
    currency: currency.toUpperCase(),
    eventId,
    orderId,
    paidAt:
      nonEmptyString(payment?.updated_at) ||
      nonEmptyString(event.created_at) ||
      new Date().toISOString(),
    paymentId,
  }
}

export function buildSquarePaymentTelegramMessage(params: {
  amountCents: number
  customerName: string
  invoiceNumber: number | string
  invoiceUrl: string
  paidAt: string
}): string {
  const paidAt = new Date(params.paidAt)
  const paidLabel = Number.isNaN(paidAt.getTime())
    ? params.paidAt
    : paidAt.toLocaleString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })

  return [
    '💳 SQUARE PAYMENT RECEIVED',
    '',
    params.customerName,
    `Invoice #${params.invoiceNumber}`,
    `Amount: $${(params.amountCents / 100).toFixed(2)}`,
    `Paid: ${paidLabel}`,
    '',
    `View invoice: ${params.invoiceUrl}`,
  ].join('\n')
}
