import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const QB_STATE_COOKIE = 'qb_oauth_state_v2'
export const QB_STATE_MAX_AGE = 600
export const QB_STATE_COOKIE_PATH = '/api/admin/quickbooks'

function signature(payload: string): Buffer {
  const secret =
    process.env.QUICKBOOKS_CLIENT_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret)
    throw new Error('QuickBooks OAuth verification is not configured')
  return createHmac('sha256', secret)
    .update(`quickbooks-oauth-state:v1:${payload}`)
    .digest()
}

export function createQBState(userId: string, now = Date.now()) {
  const state = randomBytes(32).toString('hex')
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      state,
      expires: now + QB_STATE_MAX_AGE * 1000,
    }),
  ).toString('base64url')
  return {
    state,
    cookie: `${payload}.${signature(payload).toString('base64url')}`,
  }
}

export function verifyQBState(
  cookie: string | undefined,
  state: string | null,
  userId: string,
  now = Date.now(),
): boolean {
  if (
    !cookie ||
    cookie.length > 2048 ||
    !state ||
    !/^[a-f0-9]{64}$/.test(state)
  )
    return false
  try {
    const parts = cookie.split('.')
    if (parts.length !== 2) return false
    const [payload, signed] = parts
    const expected = signature(payload)
    const supplied = Buffer.from(signed, 'base64url')
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return false
    const saved = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return (
      saved.userId === userId &&
      typeof saved.state === 'string' &&
      saved.state.length === state.length &&
      timingSafeEqual(Buffer.from(saved.state), Buffer.from(state)) &&
      Number.isFinite(saved.expires) &&
      saved.expires > now &&
      saved.expires <= now + QB_STATE_MAX_AGE * 1000
    )
  } catch {
    return false
  }
}
