// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), deliver: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/gps/canvassNotifications', () => ({
  deliverDavidCanvassNotifications: mocks.deliver,
}))
import { GET } from './route'
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-only-secret')
})
describe('canvassing notification retries', () => {
  it('rejects a request without the configured cron secret', async () => {
    const res = await GET(
      new NextRequest('https://example.com/api/cron/canvass-notifications'),
    )
    expect(res.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('retries only David pending events and reports failures for the next run', async () => {
    const q: any = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      in: vi.fn(() => q),
      or: vi.fn(() => q),
      order: vi.fn(() => q),
      limit: async () => ({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
    }
    const db = { from: vi.fn(() => q) }
    mocks.admin.mockReturnValue(db)
    mocks.deliver.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const res = await GET(
      new NextRequest('https://example.com/api/cron/canvass-notifications', {
        headers: { authorization: 'Bearer test-only-secret' },
      }),
    )
    expect(await res.json()).toEqual({ processed: 2, pending: 1 })
    expect(q.eq).toHaveBeenCalledWith('user_id', DAVID_CANVASS_USER_ID)
    expect(q.or).toHaveBeenCalledWith(
      'start_telegram_notified_at.is.null,and(status.eq.completed,stop_telegram_notified_at.is.null)',
    )
    expect(mocks.deliver.mock.calls.map((c) => c[1])).toEqual(['a', 'b'])
  })
})
