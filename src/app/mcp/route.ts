import { NextRequest, NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isHttpsRequest } from '@/lib/api-v1/http'
import {
  authorizeMcpBearer,
  McpAuthorizationError,
  mcpWwwAuthenticate,
} from '@/lib/mcp/auth'
import { createSasquatchMcpServer } from '@/lib/mcp/server'

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
}

export async function POST(request: NextRequest): Promise<Response> {
  const startedAt = Date.now()
  let response: Response

  try {
    if (!isHttpsRequest(request)) {
      response = jsonError('HTTPS is required', 400)
    } else {
      const authorization = await authorizeMcpBearer(
        request.headers.get('authorization'),
      )
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
  await logMcpRequest(request, response.status, startedAt)
  return response
}

async function methodNotAllowed(request: NextRequest) {
  const startedAt = Date.now()
  const response = isHttpsRequest(request)
    ? jsonError('Method not allowed', 405, { Allow: 'POST' })
    : jsonError('HTTPS is required', 400)
  await logMcpRequest(request, response.status, startedAt)
  return response
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
