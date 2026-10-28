// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  sendTelegramNotification: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/telegram', () => ({
  sendTelegramNotification: mocks.sendTelegramNotification,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APPOINTMENT_WEBHOOK_SECRET', 'test-webhook-secret')
})

afterEach(() => vi.unstubAllEnvs())

describe('appointment-booked webhook', () => {
  it.each([false, true])(
    'rejects missing configuration or credentials before parsing/lookup: %s',
    async (configured) => {
      if (!configured) vi.stubEnv('APPOINTMENT_WEBHOOK_SECRET', '')
      const response = await POST(
        new NextRequest(
          'https://example.test/api/webhooks/appointment-booked',
          { method: 'POST', body: 'not json' },
        ),
      )
      expect(response.status).toBe(configured ? 401 : 503)
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
      expect(mocks.sendTelegramNotification).not.toHaveBeenCalled()
    },
  )
  it.each([
    { type: 'INSERT' },
    { type: 'INSERT', record: { id: 'not-an-id' } },
    { type: 'unknown' },
  ])('rejects malformed signed payload %j', async (body) => {
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/appointment-booked', {
        method: 'POST',
        headers: { 'x-webhook-secret': 'test-webhook-secret' },
        body: JSON.stringify(body),
      }),
    )
    expect(response.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('drops integration-test fixtures before retrying or notifying Telegram', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        source: 'integration_test',
        ops_appointment_line_items: [],
      },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ single })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    mocks.createAdminClient.mockReturnValue({ from })

    const response = await POST(
      new NextRequest('https://example.com/api/webhooks/appointment-booked', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify({
          type: 'INSERT',
          record: { id: '00000000-0000-4000-8000-000000000001' },
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      skipped: 'integration_test',
    })
    expect(single).toHaveBeenCalledTimes(1)
    expect(mocks.sendTelegramNotification).not.toHaveBeenCalled()
  })
  it('does not notify staff for Outreach measuring estimates', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: '00000000-0000-4000-8000-000000000002',
        source: 'Outreach measuring bridge',
        kind: 'estimate',
        ops_appointment_line_items: [
          { name_snapshot: 'Measured fixture area' },
        ],
      },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ single })
    const select = vi.fn().mockReturnValue({ eq })
    mocks.createAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    })
    const response = await POST(
      new NextRequest('https://example.test/api/webhooks/appointment-booked', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': 'test-webhook-secret',
        },
        body: JSON.stringify({
          type: 'INSERT',
          record: { id: '00000000-0000-4000-8000-000000000002' },
        }),
      }),
    )
    expect(await response.json()).toEqual({ success: true, skipped: true })
    expect(mocks.sendTelegramNotification).not.toHaveBeenCalled()
  })
})
