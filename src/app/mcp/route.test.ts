// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AuthInfo } from '@modelcontextprotocol/server'

const owner = 'f8b5e475-eaee-4b1c-9cf1-e40b7195a22f'
const authorization = {
  token: 'test-token',
  clientId: 'chatgpt-test',
  scopes: ['business:read'],
  extra: { subject: owner, email: 'owner@example.com' },
} satisfies AuthInfo

vi.mock('@/lib/mcp/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/auth')>()
  return {
    ...actual,
    authorizeMcpBearer: vi.fn(async (header: string | null) => {
      if (header !== 'Bearer test-token') {
        throw new actual.McpAuthorizationError(
          'A Bearer access token is required',
        )
      }
      return authorization
    }),
  }
})

const insert = vi.fn().mockResolvedValue({ error: null })
const rpc = vi.fn().mockResolvedValue({
  data: [{ allowed: true, retry_after_seconds: 0 }],
  error: null,
})

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      insert,
    }),
  }),
}))

import { POST } from './route'

const endpoint = 'https://sightings.sasquatchcarpet.com/mcp'

function request(body: Record<string, unknown>, headers?: HeadersInit) {
  return new NextRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      Authorization: 'Bearer test-token',
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

async function rpcPayload(response: Response) {
  const text = await response.text()
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6)
    if (!data) throw new Error(`Missing SSE data frame: ${text}`)
    return JSON.parse(data)
  }
  return JSON.parse(text)
}

const modernMeta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': {
    name: 'chatgpt-regression-test',
    version: '1',
  },
  'io.modelcontextprotocol/clientCapabilities': {},
}

describe('/mcp authentication', () => {
  beforeEach(() => {
    insert.mockClear()
    rpc.mockClear()
  })

  it('returns an OAuth discovery challenge without a Bearer token', async () => {
    const response = await POST(
      new NextRequest('https://sightings.sasquatchcarpet.com/mcp', {
        method: 'POST',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://sightings.sasquatchcarpet.com/.well-known/oauth-protected-resource"',
    )
  })

  it('serves discovery, tool listing, and a read-only tool call over MCP 2026-07-28', async () => {
    const discover = await POST(
      request(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'server/discover',
          params: { _meta: modernMeta },
        },
        {
          'MCP-Protocol-Version': '2026-07-28',
          'MCP-Method': 'server/discover',
        },
      ),
    )
    expect(discover.status).toBe(200)
    expect(await rpcPayload(discover)).toMatchObject({
      result: {
        supportedVersions: ['2026-07-28'],
        capabilities: { tools: {}, events: {} },
      },
    })

    const list = await POST(
      request(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: { _meta: modernMeta },
        },
        {
          'MCP-Protocol-Version': '2026-07-28',
          'MCP-Method': 'tools/list',
        },
      ),
    )
    expect(list.status).toBe(200)
    const listed = await rpcPayload(list)
    expect(listed.result.tools).toHaveLength(31)
    expect(listed.result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'get_capability_catalog' }),
      ]),
    )

    const call = await POST(
      request(
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'get_capability_catalog',
            arguments: {},
            _meta: modernMeta,
          },
        },
        {
          'MCP-Protocol-Version': '2026-07-28',
          'MCP-Method': 'tools/call',
          'MCP-Name': 'get_capability_catalog',
        },
      ),
    )
    expect(call.status).toBe(200)
    const called = await rpcPayload(call)
    expect(called.error).toBeUndefined()
    expect(called).toMatchObject({
      result: {
        structuredContent: {
          server: { name: 'sasquatch-sightings-read', version: '1.5.1' },
        },
      },
    })
  })

  it('keeps the legacy initialize and tools/list flow working', async () => {
    const initialize = await POST(
      request({
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'legacy-regression-test', version: '1' },
        },
      }),
    )
    expect(initialize.status).toBe(200)
    expect(await rpcPayload(initialize)).toMatchObject({
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'sasquatch-sightings-read', version: '1.5.1' },
      },
    })

    const list = await POST(
      request(
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/list',
          params: {},
        },
        { 'MCP-Protocol-Version': '2025-11-25' },
      ),
    )
    expect(list.status).toBe(200)
    expect((await rpcPayload(list)).result.tools).toHaveLength(31)
  })
})
