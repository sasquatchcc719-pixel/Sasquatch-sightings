import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGHTING_SUBMISSION_COOKIE = 'sighting_submission'
export const SIGHTING_SUBMISSION_MAX_AGE = 24 * 60 * 60

function signature(payload: string): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('Submission verification is not configured')
  return createHmac('sha256', secret)
    .update(`sightings-contest-submission:v1:${payload}`)
    .digest()
}

export function signSightingSubmission(id: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ id, expires: now + SIGHTING_SUBMISSION_MAX_AGE * 1000 }),
  ).toString('base64url')
  return `${payload}.${signature(payload).toString('base64url')}`
}

export function verifySightingSubmission(
  token: string | undefined,
  id: string,
  now = Date.now(),
): boolean {
  if (!token || token.length > 1024) return false
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [payload, signed] = parts
    const expected = signature(payload)
    const supplied = Buffer.from(signed, 'base64url')
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return false
    }
    const submission = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return (
      submission.id === id &&
      Number.isFinite(submission.expires) &&
      submission.expires > now &&
      submission.expires <= now + SIGHTING_SUBMISSION_MAX_AGE * 1000
    )
  } catch {
    return false
  }
}
