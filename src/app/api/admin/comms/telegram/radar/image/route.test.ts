// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  report: vi.fn(),
  render: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/lib/radar-scan', () => ({ buildRadarDailyReport: mocks.report }))
vi.mock('@/lib/reports/report-card', () => ({
  renderReportCardPng: mocks.render,
}))
import { GET } from './route'
beforeEach(() => vi.resetAllMocks())
describe('private ranking chart', () => {
  it('refuses anonymous access without querying reports', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    const r = await GET()
    expect(r.status).toBe(403)
    expect(mocks.report).not.toHaveBeenCalled()
  })
  it('serves the chart privately for authorized staff', async () => {
    mocks.auth.mockResolvedValue({ role: 'owner' })
    mocks.report.mockResolvedValue({ card: {} })
    mocks.render.mockResolvedValue(Buffer.from([137, 80, 78, 71]))
    const r = await GET()
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toContain('private')
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    )
  })
})
