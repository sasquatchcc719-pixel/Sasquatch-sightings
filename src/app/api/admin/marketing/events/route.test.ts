// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.client }))
import { GET, POST, PATCH } from './route'

describe('marketing event timeline API', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns JSON and denies access before opening the database', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    const response = await GET(
      new NextRequest('https://example.com/api/admin/marketing/events'),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Not authorized' })
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('returns dated events for the signed-in marketing dashboard', async () => {
    mocks.auth.mockResolvedValue({ id: 'staff', role: 'marketing' })
    const events = [
      { id: 'repair', title: 'Independent ranking checks enabled' },
    ]
    const limit = vi.fn().mockResolvedValue({ data: events, error: null })
    mocks.client.mockReturnValue({
      from: () => ({ select: () => ({ order: () => ({ limit }) }) }),
    })
    const response = await GET(
      new NextRequest('https://example.com/api/admin/marketing/events'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, events })
    expect(mocks.auth).toHaveBeenCalledWith(['admin', 'owner', 'marketing'])
  })

  it('rejects invalid event categories without a database write', async () => {
    mocks.auth.mockResolvedValue({ id: 'staff', role: 'marketing' })
    const response = await POST(
      new NextRequest('https://example.com/api/admin/marketing/events', {
        method: 'POST',
        body: JSON.stringify({ title: 'Repair', category: 'bad' }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })
})

describe('optional SEO change evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ role: 'marketing' })
  })
  it('rejects malformed evidence before database access', async () => {
    const response = await POST(
      new NextRequest('https://example.com', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Change',
          category: 'website',
          seo_change: { version: 1 },
        }),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('keeps legacy event inserts compatible', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocks.client.mockReturnValue({ from: () => ({ insert }) })
    const response = await POST(
      new NextRequest('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ title: 'Change', category: 'website' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(insert.mock.calls[0][0]).not.toHaveProperty('seo_change')
  })
})

const validChange = {
  version: 1,
  hypothesis: 'Clearer page context',
  exactChange: 'Updated heading',
  deploymentRef: null,
  deployedAt: null,
  affectedUrls: [],
  queries: [],
  baseline: [],
  reviewDates: ['2026-11-23'],
  outcomes: [],
}
describe('revision-checked ledger updates', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ role: 'marketing' })
  })
  const request = (overrides = {}) =>
    new NextRequest('https://example.com', {
      method: 'PATCH',
      body: JSON.stringify({
        id: '11111111-1111-1111-1111-111111111111',
        expected_revision: 0,
        seo_change: validChange,
        ...overrides,
      }),
    })
  it('denies unauthorized edits before database access', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    expect((await PATCH(request())).status).toBe(403)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it('rejects invalid revision and evidence', async () => {
    expect((await PATCH(request({ expected_revision: -1 }))).status).toBe(400)
    expect((await PATCH(request({ seo_change: {} }))).status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'uses an atomic revision match; conflict=%s',
    async (conflict) => {
      const q: any = {}
      for (const key of ['update', 'eq', 'select']) q[key] = vi.fn(() => q)
      q.maybeSingle = vi
        .fn()
        .mockResolvedValue({
          data: conflict ? null : { id: 'id', seo_revision: 1 },
          error: null,
        })
      mocks.client.mockReturnValue({ from: () => q })
      expect((await PATCH(request())).status).toBe(conflict ? 409 : 200)
      expect(q.eq).toHaveBeenCalledWith('seo_revision', 0)
      expect(q.update).toHaveBeenCalledWith({
        seo_change: validChange,
        seo_revision: 1,
      })
    },
  )
})
