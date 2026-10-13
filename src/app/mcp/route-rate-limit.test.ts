// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  insertLog: vi.fn(),
}))

vi.mock('@/lib/mcp/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/auth')>()
  return { ...actual, authorizeMcpBearer: mocks.authorize }
})

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ insert: mocks.insertLog }),
  }),
}))

import { POST } from './route'

describe('/mcp rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({
      token: 'not-logged',
      clientId: 'chatgpt',
      scopes: ['business:read'],
      extra: {
        subject: 'f8b5e475-eaee-4b1c-9cf1-e40b7195a22f',
      },
    })
    mocks.rpc.mockResolvedValue({
      data: [{ allowed: false, retry_after_seconds: 7 }],
      error: null,
    })
    mocks.insertLog.mockResolvedValue({ error: null })
  })

  it('returns 429 with Retry-After before invoking a tool', async () => {
    const response = await POST(
      new NextRequest('https://sightings.sasquatchcarpet.com/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid.test.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      }),
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('7')
    expect(await response.json()).toEqual({ error: 'Rate limit exceeded' })
    expect(mocks.insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: '/mcp', status: 429 }),
    )
  })
})
