import { createHmac, timingSafeEqual } from 'crypto'

export type PaymentLinkProvider = 'square' | 'venmo'

const TOKEN_VERSION = 1
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30

type PaymentLinkPayload = {
  v: typeof TOKEN_VERSION
  i: string
  p: PaymentLinkProvider
  exp: number
}

export class PaymentLinkTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired',
  ) {
    super(message)
    this.name = 'PaymentLinkTokenError'
  }
}

function signingSecret(): string {
  const secret =
    process.env.PAYMENT_LINK_SIGNING_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TWILIO_AUTH_TOKEN

  if (!secret) {
    throw new Error('Payment link signing is not configured.')
  }
  return secret
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(encodedPayload)
    .digest('base64url')
}

function isProvider(value: unknown): value is PaymentLinkProvider {
  return value === 'square' || value === 'venmo'
}

export function createInvoicePaymentToken(params: {
  invoiceId: string
  provider: PaymentLinkProvider
  expiresAt?: Date
}): string {
  const expiresAt =
    params.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000)
  const payload: PaymentLinkPayload = {
    v: TOKEN_VERSION,
    i: params.invoiceId,
    p: params.provider,
    exp: Math.floor(expiresAt.getTime() / 1000),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyInvoicePaymentToken(
  token: string,
  now: Date = new Date(),
): { invoiceId: string; provider: PaymentLinkProvider; expiresAt: Date } {
  const [encodedPayload, signature, ...extra] = token.split('.')
  if (!encodedPayload || !signature || extra.length > 0) {
    throw new PaymentLinkTokenError('Payment link is invalid.', 'invalid')
  }

  const expected = sign(encodedPayload)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new PaymentLinkTokenError('Payment link is invalid.', 'invalid')
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    throw new PaymentLinkTokenError('Payment link is invalid.', 'invalid')
  }

  const candidate = payload as Partial<PaymentLinkPayload>
  if (
    candidate.v !== TOKEN_VERSION ||
    typeof candidate.i !== 'string' ||
    candidate.i.length === 0 ||
    !isProvider(candidate.p) ||
    typeof candidate.exp !== 'number' ||
    !Number.isFinite(candidate.exp)
  ) {
    throw new PaymentLinkTokenError('Payment link is invalid.', 'invalid')
  }

  const expiresAt = new Date(candidate.exp * 1000)
  if (expiresAt.getTime() <= now.getTime()) {
    throw new PaymentLinkTokenError('Payment link has expired.', 'expired')
  }

  return {
    invoiceId: candidate.i,
    provider: candidate.p,
    expiresAt,
  }
}

export function buildPublicPaymentUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/pay/${encodeURIComponent(token)}`
}
