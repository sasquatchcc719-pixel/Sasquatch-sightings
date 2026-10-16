// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ blacklist: vi.fn() }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))
import { POST } from './route'

const payload = { customer: { phone: '+17195550123' } }
const request = () =>
  new NextRequest('https://example.com/api/book', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BOOKING_API_SECRET', 'test-booking-secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('booking proxy blacklist enforcement', () => {
  it('blocks the nested customer phone used by the booking and NFC widgets', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mocks.blacklist.mockResolvedValue(true)

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mocks.blacklist).toHaveBeenCalledWith(payload.customer.phone)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards an allowed booking and preserves the public route response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: 'Service address is required' },
          { status: 400 },
        ),
      )
    vi.stubGlobal('fetch', fetch)
    mocks.blacklist.mockResolvedValue(false)

    const response = await POST(request())

    expect(mocks.blacklist).toHaveBeenCalledWith(payload.customer.phone)
    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/api/public/appointments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Service address is required',
    })
  })
})
