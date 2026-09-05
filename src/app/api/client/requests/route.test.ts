// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  telegram: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireClientManager: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.telegram }))
import { POST } from './route'
const agreementId = 'ad0c4a2d-17c2-4e36-a405-91d25dc10c35'
let agreementResult: {
  data: Record<string, unknown> | null
  error: Error | null
}
let filters: unknown[][]
let insert: ReturnType<typeof vi.fn>
const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest('http://localhost/api/client/requests', {
    method: 'POST',
    body: JSON.stringify({
      request_type: 'scope_change',
      agreement_id: agreementId,
      message: 'Please make carpet cleaning quarterly.',
      ...extra,
    }),
  })
beforeEach(() => {
  vi.clearAllMocks()
  filters = []
  agreementResult = {
    data: {
      id: agreementId,
      version: 2,
      status: 'published',
      content: { title: 'Commercial maintenance' },
    },
    error: null,
  }
  mocks.access.mockResolvedValue({
    user: { id: 'user-a' },
    client: {
      customer_id: 'customer-a',
      display_name: 'Manager',
      can_sign_agreements: false,
    },
  })
  mocks.telegram.mockResolvedValue(true)
  insert = vi.fn()
  mocks.db.mockReturnValue({
    from: (table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((key: string, value: unknown) => {
          filters.push([table, key, value])
          return query
        }),
        maybeSingle: vi.fn(async () => agreementResult),
        single: vi.fn(async () => ({
          data:
            table === 'ops_customers'
              ? { business_name: 'Example Business' }
              : { id: 'request-a' },
          error: null,
        })),
        insert: vi.fn((value: unknown) => {
          insert(value)
          return query
        }),
      }
      return query
    },
  })
})
describe('agreement feedback through client requests', () => {
  it('requires a client account', async () => {
    mocks.access.mockRejectedValue(new Error('Not a client manager'))
    expect((await POST(request())).status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
  })
  it('links server-held agreement metadata to a pending request and alerts staff', async () => {
    expect((await POST(request())).status).toBe(201)
    expect(filters).toContainEqual([
      'ops_commercial_agreements',
      'customer_id',
      'customer-a',
    ])
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'customer-a',
        status: 'pending',
        request_type: 'scope_change',
        details: {
          agreement_id: agreementId,
          agreement_title: 'Commercial maintenance',
          agreement_version: '2',
        },
      }),
    )
    expect(mocks.telegram).toHaveBeenCalledWith(
      expect.stringContaining('AGREEMENT NOTE'),
    )
    expect(mocks.telegram).toHaveBeenCalledWith(
      expect.stringContaining('Commercial maintenance · version 2'),
    )
  })
  it('rejects missing or other-customer agreements', async () => {
    agreementResult.data = null
    expect((await POST(request())).status).toBe(404)
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.telegram).not.toHaveBeenCalled()
  })
  it.each(['draft', 'signed', 'withdrawn'])(
    'does not accept review feedback for a %s version',
    async (status) => {
      agreementResult.data!.status = status
      expect((await POST(request())).status).toBe(
        status === 'draft' ? 404 : 409,
      )
      expect(insert).not.toHaveBeenCalled()
    },
  )
  it('rejects invalid identifiers, blank feedback, and forged metadata', async () => {
    expect((await POST(request({ agreement_id: 'not-an-id' }))).status).toBe(
      400,
    )
    expect((await POST(request({ message: '   ' }))).status).toBe(400)
    expect(
      (await POST(request({ details: { agreement_title: 'Forged terms' } })))
        .status,
    ).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })
  it('rejects the removed additional-work request path', async () => {
    const res = await POST(
      request({ agreement_id: undefined, request_type: 'add_visit' }),
    )
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
    expect(mocks.telegram).not.toHaveBeenCalled()
  })
  it('retries a failed Telegram delivery without inserting another request', async () => {
    mocks.telegram.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const res = await POST(request())
    expect(res.status).toBe(201)
    expect((await res.json()).telegram_sent).toBe(true)
    expect(mocks.telegram).toHaveBeenCalledTimes(2)
    expect(insert).toHaveBeenCalledTimes(1)
  })
  it('preserves a saved request and records failed delivery when Telegram is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.telegram.mockResolvedValue(false)
    const res = await POST(request())
    expect(res.status).toBe(201)
    expect((await res.json()).telegram_sent).toBe(false)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('delivery failed'),
      expect.objectContaining({ requestId: 'request-a' }),
    )
    log.mockRestore()
  })
  it('keeps long notes within Telegram message limits without losing the link', async () => {
    await POST(
      request({
        message: 'x'.repeat(2000),
      }),
    )
    const text = mocks.telegram.mock.calls[0][0]
    expect(text.length).toBeLessThan(4096)
    expect(text).toContain('/commercial#client-request-request-a')
  })
})
