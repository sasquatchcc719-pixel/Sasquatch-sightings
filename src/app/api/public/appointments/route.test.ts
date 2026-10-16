// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ db: vi.fn(), blacklist: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))
import { POST } from './route'

const customer = {
  first_name: 'Blocked',
  last_name: 'Customer',
  email: 'customer@example.com',
  phone: '+1 (719) 555-0123',
}
const request = () =>
  new NextRequest('https://example.com/api/public/appointments', {
    method: 'POST',
    headers: { 'x-booking-secret': 'test-booking-secret' },
    body: JSON.stringify({ customer }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BOOKING_API_SECRET', 'test-booking-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('public booking blacklist enforcement', () => {
  it('rejects a blacklisted website customer before any booking database work', async () => {
    const from = vi.fn()
    mocks.db.mockReturnValue({ from })
    mocks.blacklist.mockResolvedValue(true)

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({
      error: 'We are unable to accept this booking.',
    })
    expect(mocks.blacklist).toHaveBeenCalledWith(customer.phone)
    expect(from).not.toHaveBeenCalled()
  })

  it('continues normal validation for a customer who is not blacklisted', async () => {
    mocks.blacklist.mockResolvedValue(false)

    const response = await POST(request())

    expect(mocks.blacklist).toHaveBeenCalledWith(customer.phone)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Service address is required',
    })
  })
})
