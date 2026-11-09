// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/gsc-watch', () => ({ runGscWatch: mocks.run }))
vi.mock('@/lib/gsc-ranking-baseline', () => ({
  runGscRankingBaseline: mocks.run,
}))
vi.mock('@/lib/gsc-opportunities', () => ({ runGscOpportunities: mocks.run }))
vi.mock('@/lib/gsc-index-sweep', () => ({ runGscIndexCheck: mocks.run }))
vi.mock('@/lib/ops/scan-scheduler', () => ({ runDueScans: mocks.run }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.notify }))
import { GET as watch } from './gsc-watch/route'
import { GET as baseline } from './gsc-ranking-baseline/route'
import { GET as opportunities } from './gsc-opportunities/route'
import { GET as index } from './gsc-index-sweep/route'
import { GET as scheduler } from './scan-scheduler/route'
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-only'
  mocks.run.mockResolvedValue({
    opportunities: [],
    newlyIndexed: [],
    droppedFromIndex: [],
    fired: ['dataforseo_grid'],
    errors: {},
  })
})
const request = () =>
  new NextRequest('https://example.com', {
    headers: { authorization: 'Bearer test-only' },
  })
describe.each([
  ['watch', watch],
  ['baseline', baseline],
  ['opportunities', opportunities],
  ['index', index],
  ['scheduler', scheduler],
] as const)('%s keeps work without SEO Telegram', (_name, handler) => {
  it('still runs the job', async () => {
    expect((await handler(request())).status).toBe(200)
    expect(mocks.run).toHaveBeenCalledOnce()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('returns failure without Telegram failure alert', async () => {
    mocks.run.mockRejectedValue(new Error('test failure'))
    expect((await handler(request())).status).toBe(500)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('preserves authentication', async () => {
    expect((await handler(new NextRequest('https://example.com'))).status).toBe(
      401,
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
it('GSC collectors have no implicit Telegram sender', () => {
  for (const name of ['gsc-watch', 'gsc-index-sweep', 'gsc-opportunities']) {
    const source = readFileSync('src/lib/' + name + '.ts', 'utf8')
    expect(source).not.toContain("from '@/lib/telegram'")
    expect(source).toContain('const notifyOwner = options.notifyOwner')
  }
})
