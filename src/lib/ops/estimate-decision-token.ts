/**
 * Signed tokens for the customer-facing "accept this estimate" link.
 *
 * Deliberately the same shape as the invoice payment link
 * (`src/lib/payments/signed-payment-link.ts`) — same HMAC, same
 * `<base64url payload>.<signature>` format, same secret fallback chain — so
 * there is only one thing to understand when either one needs debugging.
 *
 * The token identifies the estimate. It does NOT carry the decision: accepting
 * is a POST from the page, never a GET on the emailed link. Corporate mail
 * scanners follow every link in an inbound message, and a GET that accepted a
 * bid would let a spam filter sign off on a job.
 */
import { createHmac, timingSafeEqual } from 'crypto'

const TOKEN_VERSION = 1
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30

type EstimateDecisionPayload = {
  v: typeof TOKEN_VERSION
  e: string
  exp: number
}

export class EstimateTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired',
  ) {
    super(message)
    this.name = 'EstimateTokenError'
  }
}

function signingSecret(): string {
  const secret =
    process.env.PAYMENT_LINK_SIGNING_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.TWILIO_AUTH_TOKEN

  if (!secret) {
    throw new Error('Estimate link signing is not configured.')
  }
  return secret
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(encodedPayload)
    .digest('base64url')
}

export function createEstimateDecisionToken(params: {
  estimateId: string
  expiresAt?: Date
}): string {
  const expiresAt =
    params.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000)
  const payload: EstimateDecisionPayload = {
    v: TOKEN_VERSION,
    e: params.estimateId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyEstimateDecisionToken(
  token: string,
  now: Date = new Date(),
): { estimateId: string; expiresAt: Date } {
  const [encodedPayload, signature, ...extra] = token.split('.')
  if (!encodedPayload || !signature || extra.length > 0) {
    throw new EstimateTokenError('Estimate link is invalid.', 'invalid')
  }

  const expected = sign(encodedPayload)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new EstimateTokenError('Estimate link is invalid.', 'invalid')
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    throw new EstimateTokenError('Estimate link is invalid.', 'invalid')
  }

  const candidate = payload as Partial<EstimateDecisionPayload>
  if (
    candidate.v !== TOKEN_VERSION ||
    typeof candidate.e !== 'string' ||
    candidate.e.length === 0 ||
    typeof candidate.exp !== 'number' ||
    !Number.isFinite(candidate.exp)
  ) {
    throw new EstimateTokenError('Estimate link is invalid.', 'invalid')
  }

  const expiresAt = new Date(candidate.exp * 1000)
  if (expiresAt.getTime() <= now.getTime()) {
    throw new EstimateTokenError('Estimate link has expired.', 'expired')
  }

  return { estimateId: candidate.e, expiresAt }
}

export function buildEstimateDecisionUrl(
  origin: string,
  token: string,
): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/estimate/${encodeURIComponent(token)}`
}
