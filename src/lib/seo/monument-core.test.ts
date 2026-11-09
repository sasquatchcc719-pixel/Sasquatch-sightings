// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MONUMENT_CORE_POINTS, scoreMonumentCore } from './monument-core'
const points = () =>
  MONUMENT_CORE_POINTS.map(([lat, lng], i) => ({
    lat,
    lng,
    my_rank: [2, 1, 3, 3, 3, 4, 5][i] as number | null,
    top_places: [{ position: 1 }],
  }))
describe('fixed Monument core v1', () => {
  it('matches the seven-point baseline without using ranks to choose pins', () => {
    expect(scoreMonumentCore(points())).toEqual({
      valid: 7,
      top3: 5,
      first: 1,
      missing: 0,
      invalid: 0,
    })
  })
  it('keeps not-found observations in the denominator', () => {
    const rows = points()
    rows[0].my_rank = null
    expect(scoreMonumentCore(rows)).toMatchObject({ valid: 7, top3: 4 })
  })
  it('does not invent zeros for empty, invalid, duplicated or missing pins', () => {
    const rows = points()
    rows[0].top_places = []
    rows[1].my_rank = 0
    rows.pop()
    rows.push(rows[2])
    expect(scoreMonumentCore(rows)).toEqual({
      valid: 3,
      top3: 2,
      first: 0,
      missing: 1,
      invalid: 3,
    })
  })
  it('ignores unrelated and shifted coordinates', () => {
    const rows = points()
    rows[0].lat += 0.001
    expect(scoreMonumentCore(rows)).toMatchObject({ valid: 6, missing: 1 })
  })
})

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMonumentCore } from './monument-core'
const scan = {
  id: 'baseline',
  status: 'completed',
  error: null,
  created_at: '2026-11-02T13:00:00Z',
  completed_at: '2026-11-02T13:01:00Z',
  center_lat: 39.115,
  center_lng: -104.78,
  spacing_miles: 2,
  preset: 'service-area',
  points_total: 141,
}
function db(scans: unknown[], rows = points()) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'order', 'limit'])
        q[method] = () => q
      q.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'radar_grid_scans' ? scans : rows,
          error: null,
        }).then(resolve)
      return q
    },
  } as unknown as SupabaseClient
}
describe('core source adapter', () => {
  const now = new Date('2026-11-09T13:00:00Z')
  it('reports coverage and same-method prior scan without mixing broad-grid data', async () => {
    const result = await loadMonumentCore(
      db([
        scan,
        {
          ...scan,
          id: 'prior',
          created_at: '2026-10-25T13:00:00Z',
          completed_at: '2026-10-25T13:01:00Z',
        },
      ]),
      now,
    )
    expect(result.state).toBe('measured')
    expect(result.summary).toContain('5/7 valid pins top 3 (71.4%)')
    expect(result.detail).toContain('Previous comparable scan 2026-10-25')
    expect(result.source).toContain('39.130145,-104.867925')
  })
  it('refuses changed geometry instead of falling back silently', async () => {
    expect(
      (await loadMonumentCore(db([{ ...scan, spacing_miles: 1 }, scan]), now))
        .state,
    ).toBe('unavailable')
  })
  it('flags stale results and suppresses trend interpretation', async () => {
    const result = await loadMonumentCore(
      db([scan]),
      new Date('2026-11-20T00:00:00Z'),
    )
    expect(result.state).toBe('stale')
    expect(result.detail).toContain('no trend conclusion')
  })
  it('shows source failures even if all core rows persisted', async () => {
    expect(
      (await loadMonumentCore(db([{ ...scan, error: 'timeout' }]), now)).state,
    ).toBe('failed')
  })
  it('does not emit 0% when no core evidence exists', async () => {
    const result = await loadMonumentCore(db([scan], []), now)
    expect(result.state).toBe('partial')
    expect(result.summary).not.toContain('0%')
    expect(result.detail).toContain('7 missing')
  })
})
