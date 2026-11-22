import { createHmac, timingSafeEqual } from 'node:crypto'

type Purpose = 'tools' | `live-invite:${string}`

function signature(payload: string, purpose: Purpose | 'quote-duration') {
  const key = process.env.HARRY_VOICE_WEBHOOK_SECRET
  if (!key) throw new Error('Missing phone assistant signing configuration')
  return createHmac('sha256', key)
    .update(purpose + ':' + payload)
    .digest('base64url')
}

// A different signature scope prevents a SIP invite from granting tool access.
// Keep the invite compact enough for Twilio's 255-character SIP URI limit.
export function issueCallToken(
  callSid: string,
  purpose: Purpose,
  issuedAt = Date.now(),
) {
  const ttl = purpose === 'tools' ? 3600 : 120
  const payload = callSid + '.' + (Math.floor(issuedAt / 1000) + ttl)
  return payload + '.' + signature(payload, purpose)
}

export function verifyCallToken(
  token: string,
  purpose: Purpose,
): string | null {
  const match = /^(CA[a-f0-9]{32})\.(\d{10})\.([\w-]{43})$/i.exec(token)
  if (!match || Number(match[2]) <= Date.now() / 1000) return null
  const expected = signature(match[1] + '.' + match[2], purpose)
  return timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))
    ? match[1]
    : null
}

// This reference attests only to a job length for a read-only calendar search.
// The separate booking tool always reprices and checks the full service request.
export function issueQuoteRef(callSid: string, minutes: number) {
  const tag = signature(callSid + '.' + minutes, 'quote-duration').slice(0, 16)
  return minutes + '.' + tag
}

export function quotedMinutes(callSid: string, ref: string): number | null {
  const match = /^([1-9]\d{0,2})\.[A-Za-z0-9_-]{16}$/.exec(ref)
  if (!match) return null
  const minutes = Number(match[1])
  return timingSafeEqual(
    Buffer.from(ref),
    Buffer.from(issueQuoteRef(callSid, minutes)),
  )
    ? minutes
    : null
}
