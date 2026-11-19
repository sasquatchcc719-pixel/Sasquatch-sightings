import { createHmac, timingSafeEqual } from 'node:crypto'

type Purpose = 'invite' | 'tools'

function signature(payload: string, purpose: Purpose) {
  const key = process.env.HARRY_VOICE_WEBHOOK_SECRET
  if (!key) throw new Error('Missing phone assistant signing configuration')
  return createHmac('sha256', key)
    .update(purpose + ':' + payload)
    .digest('base64url')
}

// A different signature scope prevents a SIP invite from granting tool access.
// Keep the invite compact enough for Twilio's 255-character SIP URI limit.
export function issueCallToken(callSid: string, purpose: Purpose) {
  const ttl = purpose === 'invite' ? 120 : 3600
  const payload = callSid + '.' + (Math.floor(Date.now() / 1000) + ttl)
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
