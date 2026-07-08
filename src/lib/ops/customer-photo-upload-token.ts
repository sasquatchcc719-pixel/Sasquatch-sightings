import { createHmac, timingSafeEqual } from 'crypto'

const TOKEN_VERSION = 1
const DEFAULT_TTL_SECONDS = 60 * 60 * 24

type CustomerPhotoUploadPayload = {
  v: typeof TOKEN_VERSION
  a: string
  i: string
  exp: number
}

export class CustomerPhotoUploadTokenError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'expired',
  ) {
    super(message)
    this.name = 'CustomerPhotoUploadTokenError'
  }
}

function signingSecret(): string {
  const secret =
    process.env.CUSTOMER_PHOTO_UPLOAD_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.BOOKING_API_SECRET

  if (!secret) {
    throw new Error('Customer photo upload signing is not configured.')
  }

  return secret
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', signingSecret())
    .update(encodedPayload)
    .digest('base64url')
}

export function createCustomerPhotoUploadToken(params: {
  appointmentId: string
  invoiceId: string
  expiresAt?: Date
}): string {
  const expiresAt =
    params.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000)
  const payload: CustomerPhotoUploadPayload = {
    v: TOKEN_VERSION,
    a: params.appointmentId,
    i: params.invoiceId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  )

  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifyCustomerPhotoUploadToken(
  token: string,
  now: Date = new Date(),
): { appointmentId: string; invoiceId: string; expiresAt: Date } {
  const [encodedPayload, signature, ...extra] = token.trim().split('.')
  if (!encodedPayload || !signature || extra.length > 0) {
    throw new CustomerPhotoUploadTokenError(
      'Photo upload token is invalid.',
      'invalid',
    )
  }

  const expected = sign(encodedPayload)
  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new CustomerPhotoUploadTokenError(
      'Photo upload token is invalid.',
      'invalid',
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    throw new CustomerPhotoUploadTokenError(
      'Photo upload token is invalid.',
      'invalid',
    )
  }

  const candidate = payload as Partial<CustomerPhotoUploadPayload>
  if (
    candidate.v !== TOKEN_VERSION ||
    typeof candidate.a !== 'string' ||
    candidate.a.length === 0 ||
    typeof candidate.i !== 'string' ||
    candidate.i.length === 0 ||
    typeof candidate.exp !== 'number' ||
    !Number.isFinite(candidate.exp)
  ) {
    throw new CustomerPhotoUploadTokenError(
      'Photo upload token is invalid.',
      'invalid',
    )
  }

  const expiresAt = new Date(candidate.exp * 1000)
  if (expiresAt.getTime() <= now.getTime()) {
    throw new CustomerPhotoUploadTokenError(
      'Photo upload token has expired.',
      'expired',
    )
  }

  return {
    appointmentId: candidate.a,
    invoiceId: candidate.i,
    expiresAt,
  }
}
