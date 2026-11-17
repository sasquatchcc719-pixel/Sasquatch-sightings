import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  trackers: [] as Record<string, unknown>[],
  notify: vi.fn(),
  update: vi.fn(),
  claim: vi.fn(),
}))

vi.mock('@/lib/telegram', () => ({
  sendTelegramNotification: mocks.notify,
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => {
        const query = {
          eq: () => query,
          gte: () => query,
          or: async () => ({ data: mocks.trackers, error: null }),
        }
        return query
      },
      update: (value: Record<string, unknown>) => {
        mocks.update(value)
        const query = {
          eq: () => query,
          is: () => query,
          select: () => ({ maybeSingle: mocks.claim }),
        }
        return query
      },
    }),
  }),
}))

import { GET } from './route'

const request = () =>
  new NextRequest('https://example.test/api/cron/fleet-temperature', {
    headers: { Authorization: 'Bearer test-secret' },
  })

const tracker = (temperatureF: number, previous: 'low' | 'high' | null) => ({
  id: 'truck',
  name: "David's Box Truck",
  probe_temperature_c: (temperatureF - 32) / 1.8,
  probe_received_at: '2026-11-17T18:00:00Z',
  temperature_low_f: 31,
  temperature_high_f: 250,
  temperature_alarm_sent: previous,
})

describe('fleet temperature alerts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-secret')
    mocks.notify.mockResolvedValue(true)
    mocks.claim.mockResolvedValue({ data: { id: 'truck' }, error: null })
  })

  it('sends one freeze alert when the temperature crosses below 31°F', async () => {
    mocks.trackers = [tracker(30.5, null)]

    expect((await GET(request())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ temperature_alarm_sent: 'low' })
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify.mock.calls[0][0]).toContain('temperature alarm: 30.5°F')
  })

  it('does not repeat the alert while the freeze alarm remains active', async () => {
    mocks.trackers = [tracker(32.9, 'low')]

    expect((await GET(request())).status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('sends one recovery message at 33°F', async () => {
    mocks.trackers = [tracker(33, 'low')]

    expect((await GET(request())).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ temperature_alarm_sent: null })
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify.mock.calls[0][0]).toContain(
      'temperature recovered: 33.0°F',
    )
  })
})
