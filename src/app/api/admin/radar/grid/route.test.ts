// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ run: vi.fn(), auth: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/lib/radar-grid', () => ({
  runGridScan: mocks.run,
  DEFAULT_GRID: {},
  estimateGridCost: () => 9,
  MAX_SERVICE_AREA_POINTS: 200,
}))
import { POST } from './route'
describe('manual grid result', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns partial attempt ID with ok false', async () => {
    mocks.run.mockResolvedValue({
      scanId: 'partial',
      pointsScanned: 8,
      error: 'one point failed',
    })
    const r = await POST(
      new NextRequest('https://example.com', { method: 'POST', body: '{}' }),
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({
      ok: false,
      scanId: 'partial',
      error: 'one point failed',
    })
  })
})
