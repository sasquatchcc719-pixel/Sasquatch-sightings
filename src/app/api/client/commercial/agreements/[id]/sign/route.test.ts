// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireClientManager: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithPassword: mocks.verify, signOut: mocks.signOut },
  }),
}))
import { POST } from './route'
import { newAgreementContent } from '@/lib/ops/commercial'
import { agreementHash } from '@/lib/ops/commercial-server'
const content = newAgreementContent('Test account')
const hash = agreementHash(content)
function request(extra: Record<string, unknown> = {}) {
  return new NextRequest(
    'http://localhost/api/client/commercial/agreements/a/sign',
    {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Manager',
        title: 'Site manager',
        password: 'example-password',
        consent: true,
        content_hash: hash,
        ...extra,
      }),
    },
  )
}
const context = { params: Promise.resolve({ id: 'agreement-a' }) }
let filters: unknown[][] = []
let update: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  filters = []
  update = vi.fn()
  mocks.access.mockResolvedValue({
    user: { id: 'user-a', email: 'client@example.test' },
    client: { customer_id: 'customer-a', can_sign_agreements: true },
  })
  mocks.verify.mockResolvedValue({
    data: { user: { id: 'user-a', app_metadata: {} } },
    error: null,
  })
  mocks.signOut.mockResolvedValue({ error: null })
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((...args: unknown[]) => {
      filters.push(args)
      return builder
    }),
    maybeSingle: vi
      .fn()
      .mockResolvedValueOnce({
        data: { status: 'published', content, content_hash: hash, revision: 3 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'agreement-a' }, error: null }),
    update,
  }
  update.mockReturnValue(builder)
  mocks.db.mockReturnValue({ from: () => builder })
})
describe('commercial signature endpoint', () => {
  it('denies staff or unauthenticated callers', async () => {
    mocks.access.mockRejectedValue(new Error('Not a client manager'))
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('requires explicit signer permission', async () => {
    mocks.access.mockResolvedValue({
      user: { id: 'u' },
      client: { can_sign_agreements: false },
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('scopes reads and atomic signing to the authenticated customer', async () => {
    expect((await POST(request(), context)).status).toBe(200)
    expect(filters.filter((f) => f[0] === 'customer_id')).toEqual([
      ['customer_id', 'customer-a'],
      ['customer_id', 'customer-a'],
    ])
    expect(filters).toContainEqual(['revision', 3])
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        signed_by: 'user-a',
        signed_email: 'client@example.test',
        status: 'signed',
      }),
    )
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('rejects stale content before password verification or writing a signature', async () => {
    expect(
      (await POST(request({ content_hash: 'f'.repeat(64) }), context)).status,
    ).toBe(409)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects the wrong password and temporary-password accounts', async () => {
    mocks.verify.mockResolvedValue({
      data: { user: null },
      error: new Error('Invalid'),
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
  it('does not sign if the user has not set a personal password', async () => {
    mocks.verify.mockResolvedValue({
      data: {
        user: { id: 'user-a', app_metadata: { must_change_password: true } },
      },
      error: null,
    })
    expect((await POST(request(), context)).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
  it('requires affirmative consent', async () => {
    expect((await POST(request({ consent: false }), context)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
