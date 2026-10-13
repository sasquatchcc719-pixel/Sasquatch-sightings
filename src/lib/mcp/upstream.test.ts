// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiV1 } from './upstream'

const authInfo = {
  token: 'signed.oauth.token',
  clientId: 'chatgpt-client',
  scopes: ['business:read'],
  resource: new URL('https://sightings.sasquatchcarpet.com/mcp'),
}

afterEach(() => vi.unstubAllGlobals())

describe('fixed Sightings API adapter', () => {
  it('performs one authenticated GET against the canonical API origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 50, offset: 0, total: 0 },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await getApiV1(
      'appointments',
      new URLSearchParams({ date: '2026-10-12', limit: '50', offset: '0' }),
      authInfo,
    )

    const [url, options] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://sightings.sasquatchcarpet.com/api/v1/appointments?date=2026-10-12&limit=50&offset=0',
    )
    expect(options).toMatchObject({
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer signed.oauth.token',
      },
    })
  })
})
