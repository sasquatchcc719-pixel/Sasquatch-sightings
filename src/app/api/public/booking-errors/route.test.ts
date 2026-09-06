// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ db: vi.fn(), alert: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/telegram', () => ({ sendBookingToolErrorAlert: mocks.alert }))
import { POST } from './route'

let event: Record<string, unknown>
let otherAlertAt: string | null

const request = () =>
  new NextRequest('https://sightings.example.test/api/public/booking-errors', {
    method: 'POST',
    headers: { Origin: 'https://sasquatchcarpet.com' },
    body: JSON.stringify({
      session_id: 's_example_123',
      stage: 'services',
      error_message: 'Failed to load services',
      http_status: 0,
    }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-05T20:00:00Z'))
  vi.stubEnv('SCOUT_ALLOWED_ORIGINS', 'https://sasquatchcarpet.com')
  mocks.alert.mockResolvedValue(true)
  event = {
    id: 'event-1',
    session_id: 's_example_123',
    stage: 'services',
    occurrence_count: 1,
    recovered_at: null,
    alert_sent_at: null,
    alert_error: null,
  }
  otherAlertAt = null
  mocks.db.mockReturnValue(
    createClient('https://logging.example.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: vi.fn(async (url, init) => {
          const query = new URL(String(url)).searchParams
          if (init?.method === 'PATCH') {
            event = { ...event, ...JSON.parse(String(init.body)) }
            return query.has('select')
              ? Response.json(event)
              : new Response(null, { status: 204 })
          }
          if (query.get('select') === 'id') {
            const cutoff = query.get('alert_sent_at')!.replace('gte.', '')
            return Response.json(
              otherAlertAt && otherAlertAt >= cutoff
                ? [{ id: 'other-event' }]
                : [],
            )
          }
          return Response.json([event])
        }),
      },
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('booking error alert lifecycle', () => {
  it('keeps suppressed reports eligible after cooldown and deduplicates delivery', async () => {
    otherAlertAt = '2026-09-05T19:59:00Z'

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: false,
    })
    expect(mocks.alert).not.toHaveBeenCalled()
    expect(event.alert_sent_at).toBeNull()

    vi.setSystemTime(new Date('2026-09-05T20:11:00Z'))

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: true,
    })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(event.alert_sent_at).toBe('2026-09-05T20:11:00.000Z')

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: false,
    })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(event.occurrence_count).toBe(4)
  })

  it('does not resend an already delivered report even after cooldown expires', async () => {
    event.alert_sent_at = '2026-09-05T19:00:00Z'

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: false,
    })
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('retries failed delivery on the next occurrence and clears the delivery error', async () => {
    event.alert_error = 'Telegram delivery failed'
    mocks.alert.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: false,
    })
    expect(event.alert_error).toBe('Telegram delivery failed')
    expect(event.alert_sent_at).toBeNull()

    expect(await (await POST(request())).json()).toMatchObject({
      recorded: true,
      alerted: true,
    })
    expect(mocks.alert).toHaveBeenCalledTimes(2)
    expect(event.alert_error).toBeNull()
    expect(event.alert_sent_at).toBe('2026-09-05T20:00:00.000Z')
  })
})
