// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CANVASS_AUTO_STOP_NOTE,
  DAVID_CANVASS_USER_ID,
} from './canvassAutoStop'
const mocks = vi.hoisted(() => ({ send: vi.fn(), after: vi.fn() }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.send }))
vi.mock('next/server', () => ({ after: mocks.after }))
import {
  deliverDavidCanvassNotifications,
  queueDavidCanvassNotification,
  CANVASS_STALE_STOP_NOTE,
} from './canvassNotifications'
function database() {
  const walk: Record<string, any> = {
    id: 'walk',
    user_id: DAVID_CANVASS_USER_ID,
    status: 'active',
    started_at: '2026-10-19T20:00:00Z',
    ended_at: null,
    distance_m: 1609.344,
    notes: null,
    start_telegram_notified_at: null,
    start_telegram_claimed_at: null,
    stop_telegram_notified_at: null,
    stop_telegram_claimed_at: null,
  }
  let failReceipt = false
  const db = {
    walk,
    setFailReceipt: (v: boolean) => {
      failReceipt = v
    },
    from: () => {
      let filters: ((row: typeof walk) => boolean)[] = []
      let values: Record<string, any> | null = null
      const execute = () => {
        if (!filters.every((f) => f(walk))) return { data: null, error: null }
        if (values) {
          if (
            failReceipt &&
            Object.keys(values).some((k) => k.endsWith('notified_at'))
          )
            return { data: null, error: { message: 'receipt failed' } }
          Object.assign(walk, values)
        }
        return { data: { ...walk }, error: null }
      }
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push((r) => r[k] === v)
          return q
        },
        is: (k: string, v: any) => {
          filters.push((r) => r[k] === v)
          return q
        },
        or: (expression: string) => {
          const [empty, old] = expression.split(',')
          const key = empty.split('.')[0]
          const cutoff = old.split('.lt.')[1]
          filters.push((r) => r[key] == null || r[key] < cutoff)
          return q
        },
        update: (v: Record<string, any>) => {
          values = v
          return q
        },
        maybeSingle: async () => execute(),
        then: (resolve: any) => Promise.resolve(execute()).then(resolve),
      }
      return q
    },
  }
  return db
}
function client(db: ReturnType<typeof database>) {
  return db as unknown as SupabaseClient
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T20:30:00Z'))
  mocks.send.mockResolvedValue(true)
})
afterEach(() => vi.useRealTimers())
describe('David canvassing Telegram delivery', () => {
  it('queues work after the API response and skips Brianna', () => {
    const db = database()
    queueDavidCanvassNotification(
      client(db),
      'walk',
      'cc9d7648-361d-4ee5-ace2-e5c485e84615',
    )
    expect(mocks.after).not.toHaveBeenCalled()
    queueDavidCanvassNotification(client(db), 'walk', DAVID_CANVASS_USER_ID)
    expect(mocks.after).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('sends one start and one manual stop with Mountain Time and GPS distance', async () => {
    const db = database()
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      true,
    )
    expect(mocks.send.mock.calls[0][0]).toContain('David started canvassing.')
    expect(mocks.send.mock.calls[0][0]).toContain('2:00 PM MDT')
    await deliverDavidCanvassNotifications(client(db), 'walk')
    expect(mocks.send).toHaveBeenCalledOnce()
    db.walk.status = 'completed'
    db.walk.ended_at = '2026-10-19T20:30:00Z'
    await deliverDavidCanvassNotifications(client(db), 'walk')
    expect(mocks.send.mock.calls[1][0]).toContain('David stopped canvassing.')
    expect(mocks.send.mock.calls[1][0]).toContain(
      'Recorded duration: 30 minutes',
    )
    expect(mocks.send.mock.calls[1][0]).toContain('GPS distance: 1.00 mi')
    expect(mocks.send.mock.calls[1][0]).toContain('Manual stop.')
    await deliverDavidCanvassNotifications(client(db), 'walk')
    expect(mocks.send).toHaveBeenCalledTimes(2)
  })
  it.each([
    [
      CANVASS_AUTO_STOP_NOTE,
      'stopped automatically',
      'Movement exceeded walking limits',
    ],
    [
      CANVASS_STALE_STOP_NOTE,
      'previous canvassing session was closed',
      'new walk started',
    ],
  ])('explains automatic and stale closures', async (note, heading, reason) => {
    const db = database()
    db.walk.start_telegram_notified_at = 'already'
    db.walk.status = 'completed'
    db.walk.ended_at = '2026-10-19T20:20:00Z'
    db.walk.notes = note
    await deliverDavidCanvassNotifications(client(db), 'walk')
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send.mock.calls[0][0]).toContain(heading)
    expect(mocks.send.mock.calls[0][0]).toContain(reason)
  })
  it('claims each event atomically when API retries and cron race', async () => {
    const db = database()
    await Promise.all([
      deliverDavidCanvassNotifications(client(db), 'walk'),
      deliverDavidCanvassNotifications(client(db), 'walk'),
    ])
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(db.walk.start_telegram_notified_at).toBeTruthy()
  })
  it('releases a failed delivery so a retry can send, without sending the stop first', async () => {
    const db = database()
    db.walk.status = 'completed'
    db.walk.ended_at = '2026-10-19T20:30:00Z'
    mocks.send.mockResolvedValueOnce(false)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      false,
    )
    expect(db.walk.start_telegram_claimed_at).toBeNull()
    expect(db.walk.start_telegram_notified_at).toBeNull()
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      true,
    )
    expect(mocks.send).toHaveBeenCalledTimes(3)
    log.mockRestore()
  })
  it('recovers a claim left by an interrupted request after five minutes', async () => {
    const db = database()
    db.walk.start_telegram_claimed_at = '2026-10-19T20:29:00Z'
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      false,
    )
    expect(mocks.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(6 * 60_000)
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      true,
    )
    expect(mocks.send).toHaveBeenCalledOnce()
  })
  it('never notifies for a different staff account, even if called with its session ID', async () => {
    const db = database()
    db.walk.user_id = 'brianna'
    expect(await deliverDavidCanvassNotifications(client(db), 'walk')).toBe(
      true,
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
