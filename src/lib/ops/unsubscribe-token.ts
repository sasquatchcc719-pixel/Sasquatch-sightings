import { createHmac, timingSafeEqual } from 'crypto'

function signingSecret(): string {
  // Preserve the established key so already-delivered links remain valid.
  const secret = process.env.DRIP_HMAC_SECRET || process.env.CRON_SECRET
  if (!secret) throw new Error('Unsubscribe signing is not configured')
  return secret
}
export function generateUnsubscribeToken(customerId: string): string {
  return createHmac('sha256', signingSecret()).update(customerId).digest('hex')
}
export function verifyUnsubscribeToken(
  customerId: string,
  token: string,
): boolean {
  const expected = generateUnsubscribeToken(customerId)
  if (!/^[a-f0-9]{64}$/.test(token)) return false
  return timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(token, 'hex'),
  )
}
