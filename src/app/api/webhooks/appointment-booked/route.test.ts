// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})

describe('appointment-booked webhook', () => {
  it('drops integration-test fixtures before retrying or notifying Telegram', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'fixture-appointment',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'INSERT',
          record: { id: 'fixture-appointment' },
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
        id: 'fixture-measuring',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'INSERT',
          record: { id: 'fixture-measuring' },
        }),
      }),
    )
    expect(await response.json()).toEqual({ success: true, skipped: true })
    expect(mocks.sendTelegramNotification).not.toHaveBeenCalled()
  })
})
