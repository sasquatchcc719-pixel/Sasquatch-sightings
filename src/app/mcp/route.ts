import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isHttpsRequest } from '@/lib/api-v1/http'
import {
  authorizeMcpBearer,
  McpAuthorizationError,
  mcpWwwAuthenticate,
} from '@/lib/mcp/auth'
import { handleMcpEventsRequest, isMcpEventsMethod } from '@/lib/mcp/events'
import { createSasquatchMcpServer } from '@/lib/mcp/server'
import { createAdminClient } from '@/supabase/server'

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: { 'Cache-Control': 'no-store', ...headers },
    },
  )
}

async function logMcpRequest(
  request: Request,
  status: number,
  startedAt: number,
  keyLabel: string | null,
  supplied?: SupabaseClient,
) {
  let rpcMethod: string | null = null
  if (request.method === 'POST') {
    try {
      const body = (await request.clone().json()) as { method?: unknown }
      rpcMethod = typeof body.method === 'string' ? body.method : null
    } catch {
      // The transport returns the protocol error for malformed JSON.
    }
  }
  console.info(
    '[mcp]',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      endpoint: new URL(request.url).pathname,
      method: request.method,
      rpc_method: rpcMethod,
      status,
      duration_ms: Date.now() - startedAt,
    }),
  )
  try {
    const supabase = supplied || createAdminClient()
    const { error } = await supabase.from('api_v1_request_logs').insert({
      requested_at: new Date().toISOString(),
      endpoint: new URL(request.url).pathname,
      method: request.method,
      status,
      key_label: keyLabel,
      duration_ms: Date.now() - startedAt,
    })
    if (error)
      console.error('[mcp] Failed to persist request log:', error.message)
  } catch (error) {
    console.error('[mcp] Failed to persist request log:', error)
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const startedAt = Date.now()
  let response: Response
  let keyLabel: string | null = null
  let supabase: SupabaseClient | undefined

  try {
    if (!isHttpsRequest(request)) {
      response = jsonError('HTTPS is required', 400)
    } else {
      const authorization = await authorizeMcpBearer(
        request.headers.get('authorization'),
      )
      const subject = String(authorization.extra?.subject || '')
      keyLabel = `mcp-oauth-${createHash('sha256').update(subject).digest('hex').slice(0, 16)}`
      supabase = createAdminClient()
      const { data: rateData, error: rateError } = await supabase.rpc(
        'consume_api_v1_token',
        { p_key_label: keyLabel },
      )
      if (rateError) throw rateError
      const rate = Array.isArray(rateData) ? rateData[0] : rateData
      if (!rate?.allowed) {
        response = jsonError('Rate limit exceeded', 429, {
          'Retry-After': String(
            Math.max(1, Number(rate?.retry_after_seconds || 1)),
          ),
        })
      } else {
        const body = (await request.clone().json()) as {
          jsonrpc?: unknown
          id?: unknown
          method?: unknown
          params?: unknown
        }
        if (isMcpEventsMethod(body.method)) {
          response = await handleMcpEventsRequest({
            request: body,
            authorization,
            supabase,
          })
        } else {
          const server = createSasquatchMcpServer()
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            maxRequestBodySize: 256 * 1024,
          })

          try {
            await server.connect(transport)
            response = await transport.handleRequest(request, {
              authInfo: authorization,
            })
          } finally {
            await transport.close()
            await server.close()
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof McpAuthorizationError) {
      response = jsonError('Unauthorized', 401, {
        'WWW-Authenticate': mcpWwwAuthenticate(error.oauthError, error.message),
      })
    } else {
      console.error('[mcp] Request failed:', error)
      response = jsonError('Internal server error', 500)
    }
  }

  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Vary', 'Authorization')
  await logMcpRequest(request, response.status, startedAt, keyLabel, supabase)
  return response
}

async function methodNotAllowed(request: NextRequest) {
  const startedAt = Date.now()
  const response = isHttpsRequest(request)
    ? jsonError('Method not allowed', 405, { Allow: 'POST' })
    : jsonError('HTTPS is required', 400)
  await logMcpRequest(request, response.status, startedAt, null)
  return response
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
