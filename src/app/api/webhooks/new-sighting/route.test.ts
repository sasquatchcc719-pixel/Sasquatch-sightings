// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), result: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
import { GET } from './route'
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('WEBHOOK_SIGHTINGS_SECRET', 'test-secret')
  mocks.result.mockResolvedValue({ data: [], error: null })
  mocks.admin.mockReturnValue({
    from: () => ({ select: () => ({ gt: () => ({ order: mocks.result }) }) }),
  })
})
afterEach(() => vi.unstubAllEnvs())
describe('new-sighting private polling webhook', () => {
  it('fails closed without configuration', async () => {
    vi.stubEnv('WEBHOOK_SIGHTINGS_SECRET', '')
    expect(
      (
        await GET(
          new NextRequest('https://example.test/api/webhooks/new-sighting'),
        )
      ).status,
    ).toBe(503)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('rejects missing/wrong header and query-string credentials', async () => {
    expect(
      (
        await GET(
          new NextRequest(
            'https://example.test/api/webhooks/new-sighting?secret=test-secret',
          ),
        )
      ).status,
    ).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('permits a configured header and prevents private response caching', async () => {
    const response = await GET(
      new NextRequest('https://example.test/api/webhooks/new-sighting', {
        headers: { 'x-webhook-secret': 'test-secret' },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.result).toHaveBeenCalled()
  })
})
