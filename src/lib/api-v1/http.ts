import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/supabase/server'

export const MERLIN_KEY_LABEL = 'merlin-read'
const KEY_HASH_ENV = 'MERLIN_READ_API_KEY_SHA256'

type ApiHandler = (context: { supabase: SupabaseClient }) => Promise<Response>

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit,
) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...headers,
      },
    },
  )
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProtocol = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase()

  return (
    forwardedProtocol === 'https' || new URL(request.url).protocol === 'https:'
  )
}

export function hasValidBearerCredential(
  authorizationHeader: string | null,
  expectedHash = process.env[KEY_HASH_ENV],
): boolean {
  if (!authorizationHeader || !expectedHash) return false

  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorizationHeader)
  const normalizedExpected = expectedHash.trim().toLowerCase()
  if (!match || !/^[a-f0-9]{64}$/.test(normalizedExpected)) return false

  const presentedDigest = createHash('sha256').update(match[1]).digest()
  const expectedDigest = Buffer.from(normalizedExpected, 'hex')

  return (
    presentedDigest.length === expectedDigest.length &&
    timingSafeEqual(presentedDigest, expectedDigest)
  )
}

async function logRequest(params: {
  request: Request
  status: number
  keyLabel: string | null
  durationMs: number
  supabase?: SupabaseClient
}) {
  const endpoint = new URL(params.request.url).pathname
  const timestamp = new Date().toISOString()
  const entry = {
    timestamp,
    endpoint,
    method: params.request.method,
    status: params.status,
    key_label: params.keyLabel,
    duration_ms: params.durationMs,
  }

  console.info('[api/v1]', JSON.stringify(entry))

  try {
    const supabase = params.supabase || createAdminClient()
    const { error } = await supabase.from('api_v1_request_logs').insert({
      requested_at: timestamp,
      endpoint,
      method: params.request.method,
      status: params.status,
      key_label: params.keyLabel,
      duration_ms: params.durationMs,
    })
    if (error) {
      console.error('[api/v1] Failed to persist request log:', error.message)
    }
  } catch (error) {
    console.error('[api/v1] Failed to persist request log:', error)
  }
}

async function consumeRateLimit(supabase: SupabaseClient): Promise<{
  allowed: boolean
  retryAfterSeconds: number
}> {
  const { data, error } = await supabase.rpc('consume_api_v1_token', {
    p_key_label: MERLIN_KEY_LABEL,
  })

  if (error) throw error

  const result = Array.isArray(data) ? data[0] : data
  return {
    allowed: Boolean(result?.allowed),
    retryAfterSeconds: Math.max(1, Number(result?.retry_after_seconds || 1)),
  }
}

export async function handleApiV1Get(
  request: NextRequest,
  handler: ApiHandler,
): Promise<Response> {
  const startedAt = Date.now()
  let keyLabel: string | null = null
  let supabase: SupabaseClient | undefined
  let response: Response

  try {
    if (!isHttpsRequest(request)) {
      response = jsonError('HTTPS is required', 400)
    } else if (!process.env[KEY_HASH_ENV]) {
      response = jsonError('API credential is not configured', 503)
    } else if (
      !hasValidBearerCredential(request.headers.get('authorization'))
    ) {
      response = jsonError('Unauthorized', 401, {
        'WWW-Authenticate': 'Bearer',
      })
    } else {
      keyLabel = MERLIN_KEY_LABEL
      supabase = createAdminClient()
      const rateLimit = await consumeRateLimit(supabase)

      if (!rateLimit.allowed) {
        response = jsonError('Rate limit exceeded', 429, {
          'Retry-After': String(rateLimit.retryAfterSeconds),
        })
      } else {
        response = await handler({ supabase })
      }
    }
  } catch (error) {
    if (error instanceof ApiRequestError) {
      response = jsonError(error.message, error.status)
    } else {
      console.error('[api/v1] Request failed:', error)
      response = jsonError('Internal server error', 500)
    }
  }

  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Vary', 'Authorization')

  await logRequest({
    request,
    status: response.status,
    keyLabel,
    durationMs: Date.now() - startedAt,
    supabase,
  })

  return response
}

export async function methodNotAllowed(
  request: NextRequest,
): Promise<Response> {
  const startedAt = Date.now()
  const response = isHttpsRequest(request)
    ? jsonError('Method not allowed', 405, { Allow: 'GET' })
    : jsonError('HTTPS is required', 400)
  await logRequest({
    request,
    status: response.status,
    keyLabel: null,
    durationMs: Date.now() - startedAt,
  })
  return response
}
