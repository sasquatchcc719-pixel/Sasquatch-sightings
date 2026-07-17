import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

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

export function buildSquarePaymentPushContent(params: {
  amountCents: number
  customerName: string
  invoiceNumber: number | string
}): string {
  return `$${(params.amountCents / 100).toFixed(2)} from ${params.customerName} · Invoice #${params.invoiceNumber}`
}

/** OneSignal requires a UUID and reuses it to suppress duplicate retries. */
export function squarePaymentPushIdempotencyKey(eventId: string): string {
  const bytes = createHash('sha256')
    .update(`square-payment-push:${eventId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
