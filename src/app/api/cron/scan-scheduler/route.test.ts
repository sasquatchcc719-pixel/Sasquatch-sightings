// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/ops/scan-scheduler', () => ({ runDueScans: mocks.run }))
import { GET } from './route'
describe('scheduler response', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test')
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllEnvs())
  it('rejects unauthenticated calls without scans', async () => {
    expect((await GET(new NextRequest('https://example.com'))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('reports partial attempts honestly without encouraging automatic HTTP retries', async () => {
    mocks.run.mockResolvedValue({
      checked: 1,
      fired: [],
      skipped: [],
      errors: { dataforseo_grid: 'partial' },
    })
    const r = await GET(
      new NextRequest('https://example.com', {
        headers: { authorization: 'Bearer test' },
      }),
    )
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(false)
  })
})
