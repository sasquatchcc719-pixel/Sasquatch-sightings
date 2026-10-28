// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  rpc: vi.fn(),
  partner: vi.fn(),
  from: vi.fn(),
  scoped: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
import { POST } from './route'
const id = '10000000-0000-4000-8000-000000000001'
function request(body: unknown = { partnerId: id, pin: '1234' }) {
  return new NextRequest('https://example.test/api/location-partner/login', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockResolvedValue({ data: true, error: null })
  mocks.partner.mockResolvedValue({
    data: {
      id,
      pin: '1234',
      company_name: 'Fixture Partner',
      phone: '7195550100',
      credit_balance: 10,
    },
    error: null,
  })
  mocks.from.mockImplementation((table) => {
    if (table === 'partners')
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: mocks.partner }) }),
        }),
      }
    return {
      select: (_columns: string, options?: unknown) => ({
        eq: (key: string, value: string) => {
          mocks.scoped(table, key, value)
          return options
            ? {
                count: 2,
                error: null,
                neq: () => Promise.resolve({ count: 1, error: null }),
              }
            : {
                gte: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }
        },
      }),
    }
  })
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: mocks.from })
})
afterEach(() => vi.restoreAllMocks())
describe('location partner PIN boundary', () => {
  it.each([
    null,
    { partnerId: 'not-a-uuid', pin: '1234' },
    { partnerId: id, pin: '1' },
    { partnerId: id, pin: 1234 },
  ])('rejects invalid input before private database work: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('atomically consumes the account budget before comparing any PIN', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    const response = await POST(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('900')
    expect(mocks.rpc).toHaveBeenCalledWith(
      'consume_location_partner_pin_attempt',
      { p_partner_id: id },
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('fails closed if durable limiting cannot run', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'db unavailable' } })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('returns the identical response for unknown accounts and incorrect PINs', async () => {
    mocks.partner
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { id, pin: '9999' }, error: null })
    const unknown = await POST(request())
    const wrong = await POST(request())
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      'partners',
      'partners',
    ])
  })
  it('returns only this partner display stats and never its PIN', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const result = await response.json()
    expect(result.partner).toMatchObject({
      id,
      totalTaps: 2,
      totalConversions: 1,
    })
    expect(JSON.stringify(result)).not.toContain('1234')
    expect(
      mocks.scoped.mock.calls.every(
        ([, key, value]) => key === 'partner_id' && value === id,
      ),
    ).toBe(true)
    expect(mocks.scoped).toHaveBeenCalledTimes(3)
  })
})
