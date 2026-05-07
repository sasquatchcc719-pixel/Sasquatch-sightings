import { createHmac, timingSafeEqual } from 'node:crypto'

const SLOT_TOKEN_TTL_MS = 15 * 60 * 1000

type SlotTokenPayload = {
  v: 1
  date: string
  start_time: string
  end_time: string
  required_minutes: number
  issued_at: number
  owner_key: string
}

export type SlotTokenParams = {
  date: string
  startTime: string
  endTime: string
  requiredMinutes: number
  ownerKey: string
}

function slotTokenSecret(): string {
  const secret =
    process.env.SLOT_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.RETELL_FUNCTION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!secret) {
    throw new Error('SLOT_TOKEN_SECRET is not configured.')
  }

  return secret
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(payload: string): string {
  return createHmac('sha256', slotTokenSecret())
    .update(payload)
    .digest('base64url')
}

function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return value.trim()

  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}:${match[3] || '00'}`
}

export function createSlotToken(params: SlotTokenParams): string {
  const payload: SlotTokenPayload = {
    v: 1,
    date: params.date,
    start_time: normalizeTime(params.startTime),
    end_time: normalizeTime(params.endTime),
    required_minutes: params.requiredMinutes,
    issued_at: Date.now(),
    owner_key: params.ownerKey,
  }
  const encodedPayload = encode(JSON.stringify(payload))
  return `${encodedPayload}.${sign(encodedPayload)}`
}

export function verifySlotToken(
  token: string,
  params: SlotTokenParams,
): { ok: true } | { ok: false; error: string } {
  const [encodedPayload, providedSignature] = token.trim().split('.')
  if (!encodedPayload || !providedSignature) {
    return { ok: false, error: 'Missing or invalid slot_token.' }
  }

  const expectedSignature = sign(encodedPayload)
  const provided = Buffer.from(providedSignature)
  const expected = Buffer.from(expectedSignature)
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { ok: false, error: 'slot_token is not valid.' }
  }

  let payload: SlotTokenPayload
  try {
    payload = JSON.parse(decode(encodedPayload)) as SlotTokenPayload
  } catch {
    return { ok: false, error: 'slot_token could not be read.' }
  }

  if (payload.v !== 1) return { ok: false, error: 'slot_token is obsolete.' }
  if (Date.now() - payload.issued_at > SLOT_TOKEN_TTL_MS) {
    return {
      ok: false,
      error: 'slot_token expired. Call get_calendar_slots again.',
    }
  }

  const expectedPayload: Omit<SlotTokenPayload, 'v' | 'issued_at'> = {
    date: params.date,
    start_time: normalizeTime(params.startTime),
    end_time: normalizeTime(params.endTime),
    required_minutes: params.requiredMinutes,
    owner_key: params.ownerKey,
  }

  for (const [key, value] of Object.entries(expectedPayload)) {
    if (payload[key as keyof typeof expectedPayload] !== value) {
      return {
        ok: false,
        error: 'slot_token does not match the selected appointment slot.',
      }
    }
  }

  return { ok: true }
}
