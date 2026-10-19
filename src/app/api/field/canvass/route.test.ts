// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  queue: vi.fn(),
  totals: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/gps/canvassSession', () => ({ canvassTotals: mocks.totals }))
vi.mock('@/lib/gps/canvassNotifications', () => ({
  queueDavidCanvassNotification: mocks.queue,
  CANVASS_STALE_STOP_NOTE: 'Closed stale session',
}))
import { POST } from './route'
function database(responses: { data?: any; error?: any }[]) {
  const calls: {
    table: string
    update?: any
    insert?: any
    filters: unknown[]
  }[] = []
  const db = {
    calls,
    from: (table: string) => {
      const call: (typeof calls)[number] = { table, filters: [] }
      calls.push(call)
      const execute = () => responses.shift() ?? { data: null, error: null }
      const q: any = {
        select: () => q,
        eq: (...args: unknown[]) => {
          call.filters.push(args)
          return q
        },
        order: () => q,
        limit: () => q,
        update: (v: any) => {
          call.update = v
          return q
        },
        insert: (v: any) => {
          call.insert = v
          return q
        },
        maybeSingle: async () => execute(),
        single: async () => execute(),
        then: (resolve: any) => Promise.resolve(execute()).then(resolve),
      }
      return q
    },
  }
  mocks.admin.mockReturnValue(db)
  return db
}
async function action(action: string) {
  const res = await POST(
    new NextRequest('https://example.com/api/field/canvass', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  )
  return { status: res.status, data: await res.json() }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: DAVID_CANVASS_USER_ID })
  mocks.totals.mockResolvedValue({ point_count: 2, distance_m: 20 })
})
describe('canvassing lifecycle Telegram hooks', () => {
  it('queues a new start only after the session is saved', async () => {
    const db = database([
      { data: null },
      { data: { id: 'new', started_at: new Date().toISOString() } },
    ])
    expect((await action('start')).status).toBe(200)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue).toHaveBeenCalledWith(db, 'new', DAVID_CANVASS_USER_ID)
  })
  it('lets delivery receipts handle a repeated Start without creating a new session', async () => {
    const db = database([
      { data: { id: 'same', started_at: new Date().toISOString() } },
      { data: { recorded_at: new Date().toISOString() } },
    ])
    expect((await action('start')).data.resumed).toBe(true)
    expect(db.calls.some((c) => c.insert)).toBe(false)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue).toHaveBeenCalledWith(db, 'same', DAVID_CANVASS_USER_ID)
  })
  it('queues the stale-session stop and new start, with a distinct stale reason', async () => {
    const db = database([
      { data: { id: 'old', started_at: '2020-01-01T00:00:00Z' } },
      { data: null },
      { data: null },
      { data: { id: 'new', started_at: new Date().toISOString() } },
    ])
    expect((await action('start')).status).toBe(200)
    expect(db.calls.find((c) => c.update)?.update.notes).toBe(
      'Closed stale session',
    )
    expect(db.calls.find((c) => c.update)?.filters).toContainEqual([
      'status',
      'active',
    ])
    expect(mocks.queue.mock.calls.map((c) => c[1])).toEqual(['old', 'new'])
  })
  it('queues the manual stop after its conditional update succeeds', async () => {
    const db = database([
      { data: { id: 'walk' } },
      { data: { id: 'walk', distance_m: 20 } },
    ])
    expect((await action('stop')).status).toBe(200)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queue).toHaveBeenCalledWith(db, 'walk', DAVID_CANVASS_USER_ID)
    expect(db.calls.find((c) => c.update)?.filters).toContainEqual([
      'status',
      'active',
    ])
  })
  it.each(['start', 'stop'])('does not announce a failed %s', async (event) => {
    database(
      event === 'start'
        ? [{ data: null }, { data: null, error: { message: 'Failed' } }]
        : [
            { data: { id: 'walk' } },
            { data: null, error: { message: 'Failed' } },
          ],
    )
    expect((await action(event)).status).toBe(500)
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('does not announce a stop lost to a concurrent request', async () => {
    database([{ data: { id: 'walk' } }, { data: null }])
    expect((await action('stop')).status).toBe(409)
    expect(mocks.queue).not.toHaveBeenCalled()
  })
  it('does not send an event for an unauthorized request', async () => {
    mocks.access.mockRejectedValue(new Error('Unauthorized'))
    expect((await action('start')).status).toBe(401)
    expect(mocks.queue).not.toHaveBeenCalled()
  })
})
