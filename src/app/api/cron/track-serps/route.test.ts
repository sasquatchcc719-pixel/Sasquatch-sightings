// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  reviews: vi.fn(),
  delivery: vi.fn(),
  notify: vi.fn(),
  report: vi.fn(),
  count: vi.fn(),
}))
vi.mock('@/lib/radar-scan', () => ({
  runRadarScan: mocks.scan,
  buildRadarDailyReport: mocks.report,
}))
vi.mock('@/lib/gbp-reviews', () => ({ syncGbpReviews: mocks.reviews }))
vi.mock('@/lib/gbp-review-count', () => ({
  recordReviewCount: mocks.count,
  formatReviewCountChange: () => 'Review count changed',
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: async () => ({ count: 100 }) }),
  }),
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.notify }))
vi.mock('@/lib/reports/telegram-report', () => ({
  deliverReportCard: mocks.delivery,
}))
import { GET } from './route'
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-only'
  mocks.scan.mockResolvedValue({ success: true })
  mocks.reviews.mockResolvedValue({ newReviews: [], totalOnGoogle: 100 })
  mocks.count.mockResolvedValue(null)
  mocks.notify.mockResolvedValue(true)
})
const request = () =>
  new NextRequest('https://example.com/api/cron/track-serps', {
    headers: { authorization: 'Bearer test-only' },
  })
describe('SEO Telegram retirement', () => {
  it('keeps scanning and syncing but sends no ranking text or image', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      digestSent: false,
      digestImageSent: false,
      seoTelegramEnabled: false,
    })
    expect(mocks.scan).toHaveBeenCalledOnce()
    expect(mocks.reviews).toHaveBeenCalledOnce()
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.delivery).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('preserves new-review and review-count notifications', async () => {
    mocks.reviews.mockResolvedValue({
      newReviews: [{ author: 'Test reviewer', rating: 5, snippet: 'Great' }],
      totalOnGoogle: 101,
    })
    mocks.count.mockResolvedValue({ previous: 100, current: 101 })
    expect((await GET(request())).status).toBe(200)
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    expect(mocks.notify.mock.calls[0][0]).toContain('New Google review')
    expect(mocks.notify.mock.calls[1][0]).toBe('Review count changed')
    expect(mocks.delivery).not.toHaveBeenCalled()
  })
  it('retains non-success status for incomplete scan without SEO alerts', async () => {
    mocks.scan.mockResolvedValue({ success: false, error_detail: 'incomplete' })
    expect((await GET(request())).status).toBe(502)
    expect(mocks.reviews).toHaveBeenCalledOnce()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated requests without any work', async () => {
    expect((await GET(new NextRequest('https://example.com'))).status).toBe(401)
    expect(mocks.scan).not.toHaveBeenCalled()
  })
})
