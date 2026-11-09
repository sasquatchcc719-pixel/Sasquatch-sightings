// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { searchconsole_v1 } from 'googleapis'
import { loadSeoBriefing } from './briefing'
const now = new Date('2026-11-09T15:00:00Z')
function database(
  overrides: Record<string, Array<{ data: unknown; error?: unknown }>> = {},
) {
  const results: Record<string, Array<{ data: unknown; error?: unknown }>> = {
    radar_grid_scans: [
      {
        data: [
          {
            id: 'scan1',
            keyword: 'carpet cleaning',
            status: 'completed',
            error: null,
            created_at: '2026-11-02T13:00:00Z',
            completed_at: '2026-11-02T13:01:00Z',
            points_total: 2,
            points_scanned: 2,
            center_lat: 39,
            center_lng: -104,
            spacing_miles: 2,
            preset: 'service-area',
          },
        ],
      },
    ],
    radar_grid_points: [
      {
        data: [
          { row_idx: 0, col_idx: 0, my_rank: 2 },
          { row_idx: 0, col_idx: 1, my_rank: null },
        ],
      },
    ],
    marketing_weekly_rollup: [
      { data: [{ week_start: '2026-10-29', week_end: '2026-11-04' }] },
      { data: [{ quote_sessions: 3, built_at: '2026-11-05T00:00:00Z' }] },
    ],
    marketing_events: [
      {
        data: [
          {
            id: 'event1',
            title: 'Changed heading',
            occurred_at: '2026-11-02',
            category: 'website',
            detail: null,
            external_ref: null,
          },
        ],
      },
    ],
    ...overrides,
  }
  const from = vi.fn((table: string) => {
    const q: any = {}
    for (const name of ['select', 'eq', 'in', 'order', 'limit'])
      q[name] = vi.fn(() => q)
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        results[table]?.shift() ?? { data: [], error: null },
      ).then(resolve)
    return q
  })
  return { db: { from } as unknown as SupabaseClient, from }
}
function google(
  rows: unknown[] | null = [{ clicks: 12, impressions: 100 }],
  prior: unknown[] | null = [{ clicks: 10, impressions: 80 }],
) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ data: { rows: [{ keys: ['2026-11-05'] }] } })
    .mockResolvedValueOnce({ data: { rows } })
    .mockResolvedValueOnce({ data: { rows: prior } })
  return {
    sc: {
      searchanalytics: { query },
    } as unknown as searchconsole_v1.Searchconsole,
    query,
  }
}
describe('read-only SEO briefing', () => {
  it('reads valid sources without mixing surfaces or periods', async () => {
    const { db, from } = database(),
      { sc, query } = google()
    const r = await loadSeoBriefing(db, { now, searchConsole: () => sc })
    const gridQuery = from.mock.results[0].value
    expect(gridQuery.eq).toHaveBeenCalledWith('platform', 'google_maps')
    expect(r.sections[0]).toMatchObject({
      state: 'measured',
      summary: '1 of 2 grid points in the top 3.',
    })
    expect(r.sections[1]).toMatchObject({
      state: 'measured',
      period: { start: '2026-10-26', end: '2026-11-01' },
    })
    expect(r.sections[2].state).toBe('partial')
    expect(r.sections[2].detail).toContain('not qualified SEO leads')
    expect(query).toHaveBeenCalledTimes(3)
    for (const [request] of query.mock.calls)
      expect(request.requestBody.dataState).toBe('final')
    expect(query.mock.calls[1][0].requestBody).toMatchObject({
      startDate: '2026-10-26',
      endDate: '2026-11-01',
    })
    expect(query.mock.calls[2][0].requestBody).toMatchObject({
      startDate: '2026-10-19',
      endDate: '2026-10-25',
    })
  })
  it('does not call missing aggregate rows zero traffic', async () => {
    const { db } = database(),
      { sc } = google(null)
    const r = await loadSeoBriefing(db, { now, searchConsole: () => sc })
    expect(r.sections[1].state).toBe('unavailable')
    expect(r.sections[1].detail).toContain('not a measured zero')
  })
  it('detects incomplete persisted grid points despite a completed scan flag', async () => {
    const { db } = database({
        radar_grid_points: [{ data: [{ row_idx: 0, col_idx: 0, my_rank: 2 }] }],
      }),
      { sc } = google()
    const r = await loadSeoBriefing(db, { now, searchConsole: () => sc })
    expect(r.sections[0].state).toBe('partial')
    expect(r.sections[0].summary).not.toContain('top 3')
  })
  it('keeps other sources readable when Google fails', async () => {
    const { db } = database()
    const r = await loadSeoBriefing(db, {
      now,
      searchConsole: () => {
        throw new Error('offline')
      },
    })
    expect(r.sections.map((s) => s.state)).toEqual([
      'measured',
      'failed',
      'partial',
    ])
    expect(r.changes).toHaveLength(1)
  })
  it('flags stale grid data rather than presenting it as this week', async () => {
    const { db } = database(),
      { sc } = google()
    const r = await loadSeoBriefing(db, {
      now: new Date('2026-11-15T15:00:00Z'),
      searchConsole: () => sc,
    })
    expect(r.sections[0].state).toBe('stale')
  })
  it('separately surfaces missing change history', async () => {
    const { db } = database({
        marketing_events: [{ data: null, error: { message: 'read failed' } }],
      }),
      { sc } = google()
    const r = await loadSeoBriefing(db, { now, searchConsole: () => sc })
    expect(r.changeHistoryError).toBe(true)
    expect(r.changes).toEqual([])
  })
})
