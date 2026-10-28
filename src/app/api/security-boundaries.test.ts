// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  feature: vi.fn(),
  capacity: vi.fn(),
  supplement: vi.fn(),
  search: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getUserWithRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/harry/features', () => ({
  isAnalystFeatureEnabled: mocks.feature,
  isAnalystHistoryReadonlyEnabled: mocks.feature,
}))
vi.mock('@/lib/ops/capacity', () => ({ loadScheduleCapacity: mocks.capacity }))
vi.mock('@/lib/ops/utilization-supplement', () => ({
  loadUtilizationSupplementRows: mocks.supplement,
}))
vi.mock('@/lib/web-search', () => ({
  searchGoogle: mocks.search,
  readWebpage: mocks.search,
  researchCompetitor: mocks.search,
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class Anthropic {} }))

import { GET as socialPosts } from './admin/social-posts/route'
import { GET as analystScan } from './analyst/scan/route'
import { GET as analystHistory, DELETE as clearAnalystHistory } from './analyst/history/route'
import { GET as analystTargets } from './analyst/targets/route'
import { GET as publicStats } from './stats/public/route'
import { GET as jobsFeed } from './jobs/feed/route'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('STATS_PUBLIC_SECRET', '')
  vi.stubEnv('JOBS_FEED_SECRET', '')
  mocks.feature.mockReturnValue(true)
  mocks.admin.mockImplementation(() => {
    throw new Error('Test stopped at database boundary')
  })
})
afterEach(() => vi.unstubAllEnvs())

function expectNoBusinessAccess() {
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.capacity).not.toHaveBeenCalled()
  expect(mocks.supplement).not.toHaveBeenCalled()
  expect(mocks.search).not.toHaveBeenCalled()
}

describe('privileged marketing read boundaries', () => {
  it.each([null, 'partner', 'client_manager', 'tech', 'dispatcher'])(
    'denies role %s before loading private social drafts or analyst data',
    async (role) => {
      mocks.access.mockResolvedValue({ user: { id: 'user-1' }, role })
      expect((await socialPosts()).status).toBe(401)
      expect((await analystScan()).status).toBe(401)
      expect((await analystHistory()).status).toBe(401)
      expect((await clearAnalystHistory()).status).toBe(401)
      expect((await analystTargets()).status).toBe(401)
      expectNoBusinessAccess()
    },
  )

  it('rejects missing identity even if a role is present', async () => {
    mocks.access.mockResolvedValue({ user: null, role: 'owner' })
    expect((await socialPosts()).status).toBe(401)
    expect((await analystScan()).status).toBe(401)
    expectNoBusinessAccess()
  })

  it('keeps analyst disabled for an authorized owner', async () => {
    mocks.access.mockResolvedValue({ user: { id: 'owner-1' }, role: 'owner' })
    mocks.feature.mockReturnValue(false)
    expect((await analystScan()).status).toBe(403)
    expect((await analystHistory()).status).toBe(403)
    expect((await clearAnalystHistory()).status).toBe(403)
    expect((await analystTargets()).status).toBe(403)
    expectNoBusinessAccess()
  })

  it('preserves owner history and targets behind verified server access', async () => {
    mocks.access.mockResolvedValue({ user: { id: 'owner-1' }, role: 'owner' })
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(async () => ({ data: [], error: null })),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    }
    mocks.admin.mockReturnValue({ from: vi.fn(() => query) })
    expect((await analystHistory()).status).toBe(200)
    expect((await analystTargets()).status).toBe(200)
    expect(mocks.admin).toHaveBeenCalledTimes(2)
  })

  it('preserves marketing access to social drafts but not analyst history', async () => {
    mocks.access.mockResolvedValue({
      user: { id: 'staff-1' },
      role: 'marketing',
    })
    expect((await analystScan()).status).toBe(401)
    expectNoBusinessAccess()
    expect((await socialPosts()).status).toBe(500)
    expect(mocks.admin).toHaveBeenCalledOnce()
  })
})

describe('external integration credentials fail closed', () => {
  it.each(['', '   '])('denies an unconfigured reader (%j)', async (secret) => {
    vi.stubEnv('STATS_PUBLIC_SECRET', secret)
    vi.stubEnv('JOBS_FEED_SECRET', secret)
    const request = new Request('https://example.test/api/reader')
    expect((await publicStats(request)).status).toBe(503)
    expect((await jobsFeed(request)).status).toBe(503)
    expectNoBusinessAccess()
  })

  it.each([undefined, 'wrong-secret'])(
    'denies missing or mismatched credentials (%s) before queue changes',
    async (provided) => {
      vi.stubEnv('STATS_PUBLIC_SECRET', 'stats-credential')
      vi.stubEnv('JOBS_FEED_SECRET', 'feed-credential')
      const headers = provided
        ? { 'x-stats-secret': provided, 'x-feed-secret': provided }
        : undefined
      const request = new Request('https://example.test/api/reader', {
        headers,
      })
      expect((await publicStats(request)).status).toBe(401)
      expect((await jobsFeed(request)).status).toBe(401)
      expectNoBusinessAccess()
    },
  )

  it('does not accept URL credentials for the mutating jobs feed', async () => {
    vi.stubEnv('JOBS_FEED_SECRET', 'feed-credential')
    const response = await jobsFeed(
      new Request('https://example.test/api/jobs/feed?secret=feed-credential'),
    )
    expect(response.status).toBe(401)
    expectNoBusinessAccess()
  })

  it.each(['x-feed-secret', 'authorization'])(
    'allows the configured jobs feed %s credential to reach the database',
    async (header) => {
      vi.stubEnv('JOBS_FEED_SECRET', 'feed-credential')
      const response = await jobsFeed(
        new Request('https://example.test/api/jobs/feed', {
          headers: {
            [header]:
              header === 'authorization'
                ? 'Bearer feed-credential'
                : 'feed-credential',
          },
        }),
      )
      expect(response.status).toBe(500)
      expect(mocks.admin).toHaveBeenCalledOnce()
    },
  )
})
