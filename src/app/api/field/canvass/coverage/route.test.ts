// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ access: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))

import { GET } from './route'

function session(
  id: string,
  started_at = '2026-10-01T12:00:00Z',
  status = 'completed',
) {
  return {
    id,
    user_id: 'david',
    started_at,
    ended_at: status === 'active' ? null : started_at,
    status,
    point_count: 2,
    distance_m: 10,
  }
}

function points(sessionId: string, count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    session_id: sessionId,
    lat: 39 + i * 0.00001,
    lng: -104.87,
    recorded_at: new Date(Date.UTC(2026, 9, 1, 12, 0, i * 10)).toISOString(),
  }))
}

// Model the real REST API cap: every query returns at most 1,000 rows,
// even if a caller requests a larger limit.
function database(
  sessions: ReturnType<typeof session>[],
  savedPoints: ReturnType<typeof points>,
  failPoints = false,
) {
  return {
    from: (table: string) => {
      let rows: Record<string, unknown>[] =
        table === 'canvass_sessions'
          ? sessions
          : table === 'canvass_points'
            ? savedPoints
            : [{ user_id: 'david', display_name: 'David' }]
      let from = 0,
        to = 999
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          rows = rows.filter((r) => r[key] === value)
          return q
        },
        in: (key: string, values: unknown[]) => {
          rows = rows.filter((r) => values.includes(r[key]))
          return q
        },
        gte: (key: string, value: string) => {
          rows = rows.filter((r) => String(r[key]) >= value)
          return q
        },
        order: () => q,
        limit: (n: number) => {
          to = Math.min(n, 1000) - 1
          return q
        },
        range: (start: number, end: number) => {
          from = start
          to = Math.min(end, start + 999)
          return q
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            resolve({
              data:
                failPoints && table === 'canvass_points'
                  ? null
                  : rows.slice(from, to + 1),
              error:
                failPoints && table === 'canvass_points'
                  ? { message: 'Point query failed' }
                  : null,
            }),
          ),
      }
      return q
    },
  }
}

async function coverage(query = '') {
  const response = await GET(
    new NextRequest(`https://example.com/api/field/canvass/coverage${query}`),
  )
  return { response, data: await response.json() }
}

describe('complete shared canvassing coverage', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
    mocks.access.mockResolvedValue({ id: 'owner' })
  })

  it('loads every GPS page so newer walks do not disappear behind the first 1,000 points', async () => {
    mocks.admin.mockReturnValue(
      database(
        [session('old'), session('new')],
        [...points('old', 1100), ...points('new')],
      ),
    )
    const { data } = await coverage()
    expect(data.geojson.features).toHaveLength(2)
    expect(
      data.geojson.features
        .find((f: any) => f.properties.sessionId === 'old')
        .geometry.coordinates.flat(),
    ).toHaveLength(1100)
    expect(data.sessions.find((s: any) => s.id === 'old').point_count).toBe(
      1100,
    )
  })

  it('loads all sessions past the former 500-walk limit and the database row cap', async () => {
    const sessions = Array.from({ length: 1002 }, (_, i) => session(String(i)))
    mocks.admin.mockReturnValue(database(sessions, points('1001')))
    const { data } = await coverage()
    expect(data.sessions).toHaveLength(1002)
    expect(data.geojson.features[0].properties.sessionId).toBe('1001')
  })

  it('includes active walks and old history by default, but excludes discarded walks', async () => {
    mocks.admin.mockReturnValue(
      database(
        [
          session('active', undefined, 'active'),
          session('old', '2024-01-01T12:00:00Z'),
          session('bad', undefined, 'discarded'),
        ],
        [...points('active'), ...points('old'), ...points('bad')],
      ),
    )
    const { data } = await coverage()
    expect(data.sessions.map((s: any) => s.id)).toEqual(['active', 'old'])
    expect(data.geojson.features).toHaveLength(2)
    expect(data.sessions[0].point_count).toBe(2)
  })

  it('colors by age at the six-month and one-year boundaries and draws recent coverage last', async () => {
    const sessions = [
      session('recent', '2026-04-19T12:00:01Z'),
      session('six', '2026-04-19T12:00:00Z'),
      session('year', '2025-10-19T12:00:00Z'),
    ]
    mocks.admin.mockReturnValue(
      database(
        sessions,
        sessions.flatMap((s) => points(s.id)),
      ),
    )
    const { data } = await coverage()
    expect(data.sessions.map((s: any) => s.color)).toEqual([
      '#22c55e',
      '#3b82f6',
      '#ef4444',
    ])
    expect(
      data.geojson.features.map((f: any) => f.properties.sessionId),
    ).toEqual(['year', 'six', 'recent'])
  })

  it('keeps date filters available when explicitly requested', async () => {
    mocks.admin.mockReturnValue(
      database(
        [session('recent'), session('old', '2024-01-01T12:00:00Z')],
        [...points('recent'), ...points('old')],
      ),
    )
    expect(
      (await coverage('?days=30')).data.sessions.map((s: any) => s.id),
    ).toEqual(['recent'])
  })

  it('reports a failed GPS query instead of returning an apparently empty map', async () => {
    mocks.admin.mockReturnValue(database([session('walk')], [], true))
    expect((await coverage()).response.status).toBe(500)
  })

  it('preserves walking segments while excluding drives between neighborhoods', async () => {
    mocks.admin.mockReturnValue(
      database(
        [session('walk')],
        [
          ...points('walk'),
          ...points('walk').map((p) => ({ ...p, lat: p.lat + 0.1 })),
        ],
      ),
    )
    const { data } = await coverage()
    expect(data.geojson.features[0].geometry.coordinates).toHaveLength(2)
  })

  it('requires staff authorization before reading locations', async () => {
    mocks.access.mockRejectedValue(new Error('Unauthorized'))
    expect((await coverage()).response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('loads one selected track and separates GPS jumps from mapped coverage', async () => {
    const saved = [
      ...points('walk'),
      ...points('walk').map((p) => ({ ...p, lat: p.lat + 0.1 })),
    ]
    mocks.admin.mockReturnValue(
      database(
        [session('walk'), session('other')],
        [...saved, ...points('other')],
      ),
    )
    const { data } = await coverage('?sessionId=walk')
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0]).toMatchObject({
      id: 'walk',
      gap_count: 1,
      distance_m: 10,
    })
    const stats = data.sessions[0]
    expect(stats.gps_distance_m).toBeGreaterThan(11000)
    expect(stats.coverage_distance_m).toBeLessThan(5)
    expect(stats.coverage_distance_m + stats.gap_distance_m).toBe(
      stats.gps_distance_m,
    )
    expect(
      data.recorded_geojson.features.find(
        (f: any) => f.properties.kind === 'samples',
      ).geometry.coordinates,
    ).toHaveLength(4)
    expect(
      data.recorded_geojson.features.find(
        (f: any) => f.properties.kind === 'connections',
      ).geometry.coordinates,
    ).toHaveLength(4)
    expect(data.geojson.features[0].geometry.coordinates).toHaveLength(2)
  })

  it('only includes the raw diagnostic trace when a track is selected', async () => {
    mocks.admin.mockReturnValue(database([session('walk')], points('walk')))
    expect((await coverage()).data.recorded_geojson).toBeUndefined()
  })

  it('can inspect a single GPS sample without inventing a line', async () => {
    mocks.admin.mockReturnValue(database([session('walk')], points('walk', 1)))
    const { data } = await coverage('?sessionId=walk')
    expect(data.sessions[0]).toMatchObject({
      has_route: false,
      gps_distance_m: 0,
      gap_count: 0,
    })
    expect(data.recorded_geojson.features).toHaveLength(1)
    expect(data.recorded_geojson.features[0].geometry.type).toBe('MultiPoint')
  })

  it('reports a missing selected walk explicitly', async () => {
    mocks.admin.mockReturnValue(database([], []))
    expect((await coverage('?sessionId=missing')).response.status).toBe(404)
  })
})
