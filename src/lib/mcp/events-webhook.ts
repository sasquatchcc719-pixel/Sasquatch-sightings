import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

function isPublicIpv4(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }
  const [a, b] = parts
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function isPublicIp(address: string) {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false
  const normalized = address.toLowerCase()
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('2001:db8:')
  ) {
    return false
  }
  return true
}

export async function resolvePublicCallback(urlValue: string) {
  const url = new URL(urlValue)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new Error('callback_invalid')
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true })
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicIp(item.address))
  ) {
    throw new Error('callback_not_public')
  }
  return { url, address: addresses[0] as LookupAddress }
}

export async function postVerifiedWebhook(params: {
  url: string
  body: string
  headers: Record<string, string>
  timeoutMs?: number
}) {
  const resolved = await resolvePublicCallback(params.url)
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpsRequest(
      resolved.url,
      {
        method: 'POST',
        headers: {
          ...params.headers,
          'Content-Length': String(Buffer.byteLength(params.body, 'utf8')),
        },
        servername: resolved.url.hostname,
        lookup: (_hostname, _options, callback) =>
          callback(null, resolved.address.address, resolved.address.family),
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          if (body.length < 64 * 1024) body += chunk
        })
        response.on('end', () =>
          resolve({ status: response.statusCode || 0, body }),
        )
      },
    )
    request.setTimeout(params.timeoutMs ?? 10_000, () => {
      request.destroy(new Error('callback_timeout'))
    })
    request.on('error', reject)
    request.end(params.body)
  })
}
