import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type SquarePosContext = {
  purpose: 'restoration' | 'invoice'
  invoiceId?: string
  invoiceNumber?: number | null
  appointmentId: string
  amountCents: number
  kind: 'deposit' | 'payment'
  returnTo: string
  actorId: string
  reference: string
  expiresAt: number
}

function signature(payload: string): string {
  const secret =
    process.env.PAYMENT_LINK_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Payment signing is not configured.')
  return createHmac('sha256', secret)
    .update(`sightings-square-pos:v1:${payload}`)
    .digest('base64url')
}

export function createSquarePosContext(
  input: Omit<SquarePosContext, 'reference' | 'expiresAt'>,
): { state: string; note: string } {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Payment amount must be a positive whole number of cents.')
  }
  const context: SquarePosContext = {
    ...input,
    reference: randomBytes(16).toString('hex'),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  }
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url')
  return {
    state: `${payload}.${signature(payload)}`,
    note: squarePosNote(context),
  }
}

export function squarePosNote(context: SquarePosContext): string {
  const invoice = context.invoiceNumber
    ? `Invoice #${context.invoiceNumber} · `
    : ''
  return `${invoice}Sightings ${context.purpose} ${context.kind} ${context.appointmentId} ${context.reference}`
}

export function verifySquarePosContext(state: string): SquarePosContext {
  const [payload, actual, ...extra] = state.split('.')
  if (!payload || !actual || extra.length || state.length > 4096)
    throw new Error('Invalid payment return.')
  const expected = Buffer.from(signature(payload))
  const provided = Buffer.from(actual)
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  )
    throw new Error('Invalid payment return.')
  const context = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as SquarePosContext
  if (
    !context ||
    typeof context.appointmentId !== 'string' ||
    !context.appointmentId ||
    typeof context.actorId !== 'string' ||
    !context.actorId ||
    !Number.isSafeInteger(context.amountCents) ||
    context.amountCents <= 0 ||
    !['deposit', 'payment'].includes(context.kind) ||
    !['restoration', 'invoice'].includes(context.purpose) ||
    (context.purpose === 'invoice' &&
      (typeof context.invoiceId !== 'string' ||
        !context.invoiceId ||
        context.kind !== 'payment')) ||
    typeof context.returnTo !== 'string' ||
    typeof context.reference !== 'string' ||
    !/^[a-f0-9]{32}$/.test(context.reference) ||
    !Number.isFinite(context.expiresAt) ||
    context.expiresAt <= Date.now()
  )
    throw new Error('Invalid or expired payment return.')
  return context
}

/** Read-only provider checks: POS transaction_id is an order ID, not a payment ID.
 * https://developer.squareup.com/docs/pos-api/payments-integration
 */
export async function verifySquarePosPayment(
  orderId: string,
  context: SquarePosContext,
) {
  const token = process.env.SQUARE_ACCESS_TOKEN
  const locationId = process.env.SQUARE_LOCATION_ID
  if (!token || !locationId)
    throw new Error('Square payment verification is not configured.')
  const base =
    process.env.SQUARE_ENVIRONMENT === 'sandbox'
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com'
  async function read(path: string) {
    const response = await fetch(`${base}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': '2025-04-16',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Square could not verify the payment.')
    return response.json()
  }
  const { order } = await read(`/v2/orders/${encodeURIComponent(orderId)}`)
  const note = squarePosNote(context)
  const notes = [
    order?.customer_note,
    ...(order?.line_items ?? []).flatMap(
      (item: { note?: string; name?: string }) => [item.note, item.name],
    ),
  ]
  if (
    order?.id !== orderId ||
    order.location_id !== locationId ||
    order.state !== 'COMPLETED' ||
    !Array.isArray(order.tenders) ||
    order.tenders.length !== 1
  )
    throw new Error('Square order does not match this payment request.')
  const tender = order.tenders[0]
  const paymentId = tender.payment_id || tender.id
  if (typeof paymentId !== 'string' || !paymentId)
    throw new Error('Square payment is not available yet.')
  const { payment } = await read(
    `/v2/payments/${encodeURIComponent(paymentId)}`,
  )
  if (
    (!notes.includes(note) && payment?.note !== note) ||
    payment?.id !== paymentId ||
    payment.order_id !== orderId ||
    payment.location_id !== locationId ||
    payment.status !== 'COMPLETED' ||
    payment.source_type !== 'CARD' ||
    payment.amount_money?.currency !== 'USD' ||
    payment.amount_money.amount !== context.amountCents ||
    Number(payment.refunded_money?.amount ?? 0) !== 0 ||
    typeof payment.created_at !== 'string' ||
    !Number.isFinite(Date.parse(payment.created_at))
  )
    throw new Error('Square payment does not match this payment request.')
  return {
    paymentId,
    orderId,
    amountCents: payment.amount_money.amount as number,
    paidAt: payment.created_at as string,
  }
}
