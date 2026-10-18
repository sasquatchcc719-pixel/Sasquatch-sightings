// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.client }))
import { GET, POST } from './route'

describe('marketing event timeline API', () => {
  beforeEach(() => vi.resetAllMocks())

  it('returns JSON and denies access before opening the database', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    const response = await GET(new NextRequest('https://example.com/api/admin/marketing/events'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Not authorized' })
    expect(mocks.client).not.toHaveBeenCalled()
  })

  it('returns dated events for the signed-in marketing dashboard', async () => {
    mocks.auth.mockResolvedValue({ id: 'staff', role: 'marketing' })
    const events = [{ id: 'repair', title: 'Independent ranking checks enabled' }]
    const limit = vi.fn().mockResolvedValue({ data: events, error: null })
    mocks.client.mockReturnValue({ from: () => ({ select: () => ({ order: () => ({ limit }) }) }) })
    const response = await GET(new NextRequest('https://example.com/api/admin/marketing/events'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, events })
    expect(mocks.auth).toHaveBeenCalledWith(['admin', 'owner', 'marketing'])
  })

  it('rejects invalid event categories without a database write', async () => {
    mocks.auth.mockResolvedValue({ id: 'staff', role: 'marketing' })
    const response = await POST(new NextRequest('https://example.com/api/admin/marketing/events', {
      method: 'POST', body: JSON.stringify({ title: 'Repair', category: 'bad' }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.client).not.toHaveBeenCalled()
  })
})
