// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

describe('/mcp authentication', () => {
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
})
