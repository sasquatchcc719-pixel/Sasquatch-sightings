import { createHmac, timingSafeEqual } from 'crypto'

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  if (aBuffer.length !== bBuffer.length) return false
  return timingSafeEqual(aBuffer, bBuffer)
}

function signatureCandidates(rawBody: string, apiKey: string): string[] {
  const hmac = createHmac('sha256', apiKey).update(rawBody)
  const hex = hmac.digest('hex')
  const base64 = createHmac('sha256', apiKey).update(rawBody).digest('base64')
  return [hex, `sha256=${hex}`, base64, `sha256=${base64}`]
}

export function verifyRetellSignature(params: {
  rawBody: string
  signature: string | null
  apiKey?: string
}): boolean {
  if (process.env.RETELL_SKIP_SIGNATURE_VERIFICATION === 'true') {
    return true
  }

  const apiKey = params.apiKey || process.env.RETELL_API_KEY
  if (!apiKey || !params.signature) return false

  return signatureCandidates(params.rawBody, apiKey).some((candidate) =>
    safeEqual(candidate, params.signature || ''),
  )
}
