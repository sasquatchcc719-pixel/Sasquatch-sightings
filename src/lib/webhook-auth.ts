import { timingSafeEqual } from 'node:crypto'

/** Compare configured webhook credentials without accepting an unset secret. */
export function matchesWebhookSecret(
  expected: string | undefined,
  received: string | null,
): boolean {
  if (!expected || !received) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  )
}
