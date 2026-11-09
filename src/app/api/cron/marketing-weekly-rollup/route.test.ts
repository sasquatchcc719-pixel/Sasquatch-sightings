// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  digest: vi.fn(),
  notify: vi.fn(),
  db: {},
}))
const windows = vi.hoisted(() => [
  { start: '2026-11-02', end: '2026-11-08' },
  { start: '2026-10-26', end: '2026-11-01' },
])
vi.mock('@/lib/ops/marketing-rollup', () => ({
  completedWeeks: () => windows,
  refreshMarketingWeeklyRollup: mocks.refresh,
  buildMarketingRollupDigest: mocks.digest,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.notify }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-only')
  mocks.refresh.mockResolvedValue({
    rows: [
      { week_start: windows[0].start },
      { week_start: windows[0].start },
      { week_start: windows[1].start },
    ],
    builtAt: '2026-11-09T15:30:00.000Z',
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const request = (authorized = true) =>
  new NextRequest('https://example.com/api/cron/marketing-weekly-rollup', {
    headers: authorized ? { authorization: 'Bearer test-only' } : {},
  })

describe('weekly briefing Telegram retirement', () => {
  it('refreshes both completed weeks without building or sending a digest', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      weekStart: windows[0].start,
      rows: 2,
      builtAt: '2026-11-09T15:30:00.000Z',
      briefingTelegramEnabled: false,
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.refresh).toHaveBeenCalledWith(mocks.db, { windows })
    expect(mocks.digest).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('preserves logged failures and HTTP status without a Telegram alert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.refresh.mockRejectedValue(new Error('Refresh failed'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Refresh failed' })
    expect(console.error).toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests without refreshing or notifying', async () => {
    expect((await GET(request(false))).status).toBe(401)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('rejects requests when the cron secret is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request())).status).toBe(401)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
