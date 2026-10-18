import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  googleHistory: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/radar-gsc-history', () => ({
  fetchRadarGoogleHistory: mocks.googleHistory,
}))

import { buildRadarDailyReport } from './radar-scan'

afterEach(() => vi.useRealTimers())

describe('Radar report measurement evidence', () => {
  it('uses stored run-specific Maps counts and carries sparse organic coverage into the report', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
    const keywords = [
      { id: 'l', keyword: 'carpet cleaning', location: 'Larkspur, CO' },
      { id: 'c', keyword: 'carpet cleaning', location: 'Castle Rock, CO' },
      { id: 'p', keyword: 'carpet cleaning', location: 'Palmer Lake, CO' },
    ]
    const tables = {
      radar_domains: [
        { id: 'ours', domain: 'sasquatchcarpet.com', is_my_domain: true },
      ],
      radar_keywords: keywords,
      radar_rankings: keywords.map((keyword) => ({
        keyword_id: keyword.id,
        finder_rank: null,
        map_rank: null,
        rank_position: null,
        created_at: '2026-10-18T11:30:00Z',
        scan_run_id: keyword.id === 'p' ? null : `run-${keyword.id}`,
      })),
      radar_scan_runs: [
        {
          id: 'run-l',
          organic_audit: null,
          radar_map_pack_snapshots: [{ count: 3 }],
        },
        {
          id: 'run-c',
          organic_audit: null,
          radar_map_pack_snapshots: [{ count: 20 }],
        },
      ],
      local_falcon_scans: [],
    }
    const selections: string[] = []
    mocks.client.mockReturnValue({
      from(table: keyof typeof tables) {
        const query = {
          select(columns: string) {
            selections.push(`${table}:${columns}`)
            return query
          },
          eq: () => query,
          gte: () => query,
          in: () => query,
          order: () => query,
          limit: () => query,
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: tables[table], error: null }).then(resolve),
        }
        return query
      },
    })
    mocks.googleHistory.mockResolvedValue([
      {
        date: '2026-09-20',
        query: 'carpet cleaning larkspur',
        impressions: 1,
        clicks: 0,
        position: 8,
      },
      {
        date: '2026-10-14',
        query: 'carpet cleaning larkspur',
        impressions: 1,
        clicks: 0,
        position: 1,
      },
    ])
    const report = await buildRadarDailyReport()
    expect(selections).toContain(
      'radar_scan_runs:id, organic_audit, radar_map_pack_snapshots(count)',
    )
    const maps = report?.card.rankHistory?.panels[0].series
    expect(maps?.map((series) => series.points[0].status)).toEqual([
      'unknown',
      'outside',
      'unknown',
    ])
    expect(report?.text).toContain(
      'Larkspur: Not returned in 3 checked Maps results',
    )
    expect(report?.text).toContain('Castle Rock: Outside top 20')
    expect(report?.text).toContain('Palmer Lake: Maps depth unavailable')
    expect(report?.text).toContain('2 impressions · 2 measured weeks')
    expect(report?.text).toContain('not searcher locations')
    expect(report?.card.rankHistory?.panels[1].series[0].points).toHaveLength(2)
  })
})
