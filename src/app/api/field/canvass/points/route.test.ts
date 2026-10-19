// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  CANVASS_AUTO_STOP_NOTE,
  DAVID_CANVASS_USER_ID,
} from '@/lib/gps/canvassAutoStop'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  queue: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/lib/gps/canvassNotifications', () => ({
  queueDavidCanvassNotification: mocks.queue,
  CANVASS_STALE_STOP_NOTE: 'Closed stale walk',
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
import { POST } from './route'
import { GET } from '../route'

const BRIANNA = 'cc9d7648-361d-4ee5-ace2-e5c485e84615'
const time = Date.parse('2026-10-19T12:00:00Z')
const point = (meters: number, seconds: number, accuracyM = 5) => ({
  lat: 39 + meters / 111195,
  lng: -104.87,
  accuracyM,
  speedMps: null,
  recordedAt: new Date(time + seconds * 1000).toISOString(),
})
function database(userId = DAVID_CANVASS_USER_ID) {
  const sessions: any[] = [
    {
      id: 'walk',
      user_id: userId,
      status: 'active',
      notes: null,
      started_at: new Date(time).toISOString(),
    },
  ]
  const saved: any[] = []
  const db = {
    sessions,
    saved,
    failUpdate: false,
    failRead: false,
    from(table: string) {
      let filters: ((r: any) => boolean)[] = []
      let sort: { key: string; asc: boolean }[] = []
      let offset = 0,
        limit = 1000
      let values: any = null,
        insert: any[] | null = null
      const execute = () => {
        const all = table === 'canvass_sessions' ? sessions : saved
        if (db.failRead && table === 'canvass_sessions')
          return { data: null, error: { message: 'Database unavailable' } }
        if (values && db.failUpdate)
          return { data: null, error: { message: 'Save failed' } }
        if (insert) {
          all.push(...insert.map((r) => ({ id: all.length + 1, ...r })))
          return { data: null, error: null }
        }
        let rows = all.filter((r) => filters.every((f) => f(r)))
        if (values) rows.forEach((r) => Object.assign(r, values))
        rows = [...rows].sort((a, b) => {
          for (const { key, asc } of sort) {
            if (a[key] !== b[key])
              return (a[key] < b[key] ? -1 : 1) * (asc ? 1 : -1)
          }
          return 0
        })
        return { data: rows.slice(offset, offset + limit), error: null }
      }
      const q: any = {
        select: () => q,
        eq: (key: string, value: any) => {
          filters.push((r) => r[key] === value)
          return q
        },
        gte: (key: string, value: any) => {
          filters.push((r) => r[key] >= value)
          return q
        },
        order: (key: string, opts?: { ascending?: boolean }) => {
          sort.push({ key, asc: opts?.ascending !== false })
          return q
        },
        limit: (n: number) => {
          limit = n
          return q
        },
        range: (start: number, end: number) => {
          offset = start
          limit = Math.min(1000, end - start + 1)
          return q
        },
        insert: (v: any[]) => {
          insert = v
          return q
        },
        update: (v: any) => {
          values = v
          return q
        },
        maybeSingle: async () => {
          const result = execute()
          return { ...result, data: result.data?.[0] ?? null }
        },
        then: (resolve: any) => Promise.resolve(execute()).then(resolve),
      }
      return q
    },
  }
  return db
}
async function upload(points: ReturnType<typeof point>[], sessionId = 'walk') {
  const res = await POST(
    new NextRequest('https://example.com/api/field/canvass/points', {
      method: 'POST',
      body: JSON.stringify({ sessionId, points }),
    }),
  )
  return { status: res.status, data: await res.json() }
}
function seed(db: ReturnType<typeof database>, p: ReturnType<typeof point>) {
  db.saved.push({
    id: db.saved.length + 1,
    session_id: 'walk',
    lat: p.lat,
    lng: p.lng,
    accuracy_m: p.accuracyM,
    recorded_at: p.recordedAt,
  })
}

afterEach(() => vi.useRealTimers())
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: DAVID_CANVASS_USER_ID })
})
describe('David-only walking cutoff', () => {
  it('saves the walking portion and stops at its last point before a drive', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    const result = await upload([
      point(0, 0),
      point(20, 20),
      point(300, 30),
      point(600, 45),
    ])
    expect(result).toEqual({
      status: 200,
      data: { ok: true, inserted: 2, autoStopped: true },
    })
    expect(mocks.queue).toHaveBeenCalledWith(db, 'walk', DAVID_CANVASS_USER_ID)
    expect(db.saved).toHaveLength(2)
    expect(db.sessions[0]).toMatchObject({
      status: 'completed',
      ended_at: point(20, 20).recordedAt,
      point_count: 2,
      distance_m: 20,
      notes: CANVASS_AUTO_STOP_NOTE,
    })
  })
  it('detects continuous driving made up of small fixes, across uploads', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    await upload([point(0, 0), point(50, 5), point(100, 10)])
    const result = await upload([
      point(150, 15),
      point(200, 20),
      point(250, 25),
    ])
    expect(result.data.autoStopped).toBe(true)
    expect(db.saved.length).toBeLessThan(6)
    expect(db.sessions[0].distance_m).toBeLessThan(200)
  })
  it('leaves Brianna e-bike tracking running for the identical movement', async () => {
    mocks.access.mockResolvedValue({ id: BRIANNA })
    const db = database(BRIANNA)
    mocks.admin.mockReturnValue(db)
    expect(
      (await upload([point(0, 0), point(300, 30), point(3000, 100)])).data
        .autoStopped,
    ).toBe(false)
    expect(db.saved).toHaveLength(3)
    expect(db.sessions[0].status).toBe('active')
    expect((await (await GET()).json()).walkingAutoStop).toBe(false)
  })
  it('allows walking and jitter, ignores poor fixes, and retains delayed walking samples', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    expect(
      (
        await upload([
          point(0, 0),
          point(20, 1),
          point(40, 30),
          point(400, 31, 100),
          point(50, 40),
        ])
      ).data.autoStopped,
    ).toBe(false)
    expect(
      (await upload([point(20, 1), point(45, 35), point(60, 50)])).data
        .autoStopped,
    ).toBe(false)
    expect(db.saved).toHaveLength(6)
    expect(db.sessions[0].status).toBe('active')
  })
  it('ends a large overnight gap without adding the new location or touching a newer walk', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    seed(db, point(0, 0))
    db.sessions.push({ ...db.sessions[0], id: 'new-walk' })
    expect((await upload([point(15000, 72000)])).data.autoStopped).toBe(true)
    expect(db.saved).toHaveLength(1)
    expect(db.sessions[1].status).toBe('active')
    expect((await upload([point(16000, 72100)])).data).toMatchObject({
      inserted: 0,
      autoStopped: true,
    })
    expect(db.saved).toHaveLength(1)
  })
  it('includes all saved points beyond the REST row cap when finalizing', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    for (let i = 0; i < 1100; i++) seed(db, point(i * 2, i * 2))
    expect((await upload([point(5000, 2210)])).data.autoStopped).toBe(true)
    expect(db.sessions[0]).toMatchObject({
      point_count: 1100,
      distance_m: 2198,
    })
  })
  it('retries a failed save without duplicating the accepted walking points', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    db.failUpdate = true
    const batch = [point(0, 0), point(20, 20), point(300, 30)]
    expect((await upload(batch)).status).toBe(500)
    db.failUpdate = false
    expect((await upload(batch)).data.autoStopped).toBe(true)
    expect(db.saved).toHaveLength(2)
    expect(db.sessions[0].status).toBe('completed')
  })
  it('still enforces David cutoff on a late batch after manual Stop', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    seed(db, point(0, 0))
    db.sessions[0].status = 'completed'
    db.sessions[0].ended_at = new Date().toISOString()
    expect((await upload([point(300, 30)])).data.autoStopped).toBe(true)
    expect(db.sessions[0].notes).toBe(CANVASS_AUTO_STOP_NOTE)
    expect(db.saved).toHaveLength(1)
  })
  it('returns David policy and previous fix when the page resumes', async () => {
    const db = database()
    mocks.admin.mockReturnValue(db)
    seed(db, point(0, 0))
    const data = await (await GET()).json()
    expect(data.walkingAutoStop).toBe(true)
    expect(data.lastPoint.recorded_at).toBe(point(0, 0).recordedAt)
  })
  it('keeps database outages retryable rather than declaring the session invalid', async () => {
    const db = database()
    db.failRead = true
    mocks.admin.mockReturnValue(db)
    expect((await upload([point(0, 0)])).status).toBe(500)
    expect(db.saved).toHaveLength(0)
    expect(db.sessions[0].status).toBe('active')
  })
  it('rejects unauthenticated or another staff member’s session', async () => {
    mocks.access.mockRejectedValueOnce(new Error('Unauthorized'))
    expect((await upload([point(0, 0)])).status).toBe(401)
    mocks.admin.mockReturnValue(database(BRIANNA))
    expect((await upload([point(0, 0)])).status).toBe(403)
  })
})
