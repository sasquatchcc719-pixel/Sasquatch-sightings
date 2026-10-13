// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { GET } from './route'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    'https://zoabgmsbvzcqpzlrhsfz.supabase.co'
})

describe('OAuth protected resource metadata', () => {
  it('binds the MCP resource to the existing Supabase authorization server', async () => {
    const response = await GET()
    expect(await response.json()).toEqual(
      expect.objectContaining({
        resource: 'https://sightings.sasquatchcarpet.com/mcp',
        authorization_servers: [
          'https://zoabgmsbvzcqpzlrhsfz.supabase.co/auth/v1',
        ],
        scopes_supported: ['openid', 'email'],
        bearer_methods_supported: ['header'],
      }),
    )
  })
})
