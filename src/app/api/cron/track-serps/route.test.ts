// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ delivery: vi.fn() }))
vi.mock('@/lib/radar-scan', () => ({
  runRadarScan: async () => ({ success: true }),
  buildRadarDailyReport: async () => ({
    runKey: 'fresh-id',
    card: {},
    text: 'report',
    caption: 'graph',
  }),
}))
vi.mock('@/lib/gbp-reviews', () => ({
  syncGbpReviews: async () => ({ newReviews: [], totalOnGoogle: 100 }),
}))
vi.mock('@/lib/gbp-review-count', () => ({
  recordReviewCount: async () => null,
  formatReviewCountChange: () => null,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: async () => ({ count: 100 }) }),
  }),
}))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: vi.fn() }))
vi.mock('@/lib/reports/telegram-report', () => ({
  deliverReportCard: mocks.delivery,
}))
import { GET } from './route'
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-only'
})
const request = () =>
  new NextRequest('https://example.com/api/cron/track-serps', {
    headers: { authorization: 'Bearer test-only' },
  })
describe('daily report image delivery', () => {
  it('surfaces a missing chart as a failed delivery instead of silent success', async () => {
    mocks.delivery.mockResolvedValue({ textSent: true, imageSent: false })
    const response = await GET(request())
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.digestImageSent).toBe(false)
    expect(body.reportDeliveryError).toContain('incomplete')
  })
  it('reports success when both text and graph were confirmed delivered', async () => {
    mocks.delivery.mockResolvedValue({ textSent: true, imageSent: true })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).digestImageSent).toBe(true)
  })
})
