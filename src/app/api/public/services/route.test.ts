// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ db: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
import { GET, OPTIONS } from './route'

const fetchCatalog = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.db.mockReturnValue(
    createClient('https://catalog.example.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchCatalog },
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('public services', () => {
  it('serves a cacheable catalog with CORS and separates checkout upsells', async () => {
    const service = {
      id: 'carpet',
      name: 'Carpet cleaning',
      category: 'Carpet Cleaning',
    }
    const upsell = {
      id: 'upsell',
      name: 'Deodorizer',
      category: 'Checkout Upsells',
    }
    fetchCatalog.mockResolvedValue(
      Response.json([
        service,
        upsell,
        {
          id: 'excluded',
          name: 'Card fee',
          slug: 'card-fee',
          category: 'Carpet Cleaning',
        },
      ]),
    )

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=600',
    )
    expect(await response.json()).toEqual({
      services: [service],
      checkoutUpsells: [upsell],
    })
  })

  it('returns uncached JSON with CORS when the database fails', async () => {
    fetchCatalog.mockResolvedValue(
      Response.json({ message: 'Database unavailable' }, { status: 500 }),
    )

    const response = await GET()

    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'Failed to load services' })
  })

  it('aborts a stalled catalog query and returns an uncached CORS error', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => timeout(1))
    fetchCatalog.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal!.aborted) {
            reject(init.signal!.reason)
            return
          }
          init.signal!.addEventListener(
            'abort',
            () => reject(init.signal!.reason),
            { once: true },
          )
        }),
    )

    const response = await GET()

    expect(timeoutSpy).toHaveBeenCalledWith(8_000)
    expect(fetchCatalog.mock.calls[0][1].signal.aborted).toBe(true)
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('allows the marketing site to preflight the catalog request', async () => {
    const response = await OPTIONS()

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'GET',
    )
    expect(fetchCatalog).not.toHaveBeenCalled()
  })
})
