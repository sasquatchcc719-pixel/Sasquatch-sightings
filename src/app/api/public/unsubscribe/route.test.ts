// @vitest-environment node
import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), db: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
import * as route from './route'

const customerId = '11111111-1111-4111-8111-111111111111'
function request(method = 'GET', token?: string, cid = customerId) {
  const signature =
    token ??
    createHmac('sha256', 'unit-test-signing-secret').update(cid).digest('hex')
  return new NextRequest(
    `https://example.com/api/public/unsubscribe?cid=${cid}&token=${signature}`,
    { method },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DRIP_HMAC_SECRET', '')
  vi.stubEnv('CRON_SECRET', 'unit-test-signing-secret')
  mocks.db.mockReturnValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({
    data: { success: true, already_unsubscribed: false },
    error: null,
  })
})

describe('marketing unsubscribe link', () => {
  it('keeps an existing signed link usable without changing data on GET', async () => {
    const response = await route.GET(request())
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('method="post"')
    expect(html).toContain('Unsubscribe from marketing')
    expect(html).not.toContain("You've been unsubscribed")
    expect(mocks.db).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('confirms only one successful atomic marketing-only operation', async () => {
    const response = await route.POST(request('POST'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain("You've been unsubscribed")
    expect(mocks.rpc).toHaveBeenCalledWith('unsubscribe_email_marketing', {
      p_customer_id: customerId,
      p_source: 'unsubscribe_link',
      p_source_message_id: null,
    })
  })

  it('never reports success after a database failure', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private database detail', code: 'XX000' },
    })
    const response = await route.POST(request('POST'))
    const html = await response.text()
    expect(response.status).toBe(503)
    expect(html).not.toContain("You've been unsubscribed")
    expect(html).not.toContain('private database detail')
    expect(html).toContain('try again')
  })

  it('rejects a missing customer instead of claiming success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0002' } })
    expect((await route.POST(request('POST'))).status).toBe(404)
  })

  it('does not accept an incomplete success receipt', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null })
    expect((await route.POST(request('POST'))).status).toBe(503)
  })

  it('allows repeated successful requests without changing the broad email preference', async () => {
    mocks.rpc.mockResolvedValue({
      data: { success: true, already_unsubscribed: true },
      error: null,
    })
    const response = await route.POST(request('POST'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('invoices and account')
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('email_opt_out')
  })

  it.each(['short', 'g'.repeat(64), '0'.repeat(64)])(
    'rejects invalid signatures without database access: %s',
    async (token) => {
      expect((await route.GET(request('GET', token))).status).toBe(403)
      expect(mocks.db).not.toHaveBeenCalled()
    },
  )

  it('fails closed when signing configuration is missing', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await route.GET(request())).status).toBe(503)
    expect(mocks.db).not.toHaveBeenCalled()
  })

  it('rejects missing or invalid customer identity', async () => {
    expect(
      (
        await route.GET(
          new NextRequest('https://example.com/api/public/unsubscribe'),
        )
      ).status,
    ).toBe(400)
    expect(
      (await route.GET(request('GET', undefined, 'not-a-uuid'))).status,
    ).toBe(400)
    expect(mocks.db).not.toHaveBeenCalled()
  })
})
