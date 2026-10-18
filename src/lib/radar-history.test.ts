import { describe, it, expect } from 'vitest'
import {
  buildMapsRankPanel,
  buildGoogleOrganicPanel,
  sameOrganicMethod,
} from './radar-history'
const keywords = [
  { id: 'm', keyword: 'carpet cleaning', location: 'Monument, CO' },
]
describe('actual ranking histories', () => {
  it('keeps #4 to #3 changes visible even though town coverage stays 1', () => {
    const panel = buildMapsRankPanel(
      keywords,
      [
        { keyword_id: 'm', finder_rank: 4, created_at: '2026-10-16T12:00:00Z' },
        { keyword_id: 'm', finder_rank: 3, created_at: '2026-10-17T12:00:00Z' },
      ],
      new Date('2026-10-18T12:00:00Z'),
    )
    expect(panel.series[0].points.map((p) => p.rank)).toEqual([4, 3])
  })
  it('uses the latest Mountain-date reading rather than best rank that day', () => {
    const panel = buildMapsRankPanel(
      keywords,
      [
        { keyword_id: 'm', finder_rank: 1, created_at: '2026-10-18T01:00:00Z' },
        { keyword_id: 'm', finder_rank: 4, created_at: '2026-10-18T02:00:00Z' },
      ],
      new Date('2026-10-18T12:00:00Z'),
    )
    expect(panel.series[0].points).toHaveLength(1)
    expect(panel.series[0].points[0]).toMatchObject({
      date: '2026-10-17',
      rank: 4,
    })
  })
  it('weights Google averages by impressions, excludes commercial queries, and leaves missing weeks empty', () => {
    const rows = [
      {
        date: '2026-10-01',
        query: 'carpet cleaning monument co',
        position: 2,
        impressions: 9,
        clicks: 0,
      },
      {
        date: '2026-10-02',
        query: 'carpet cleaning monument co',
        position: 12,
        impressions: 1,
        clicks: 0,
      },
      {
        date: '2026-10-02',
        query: 'commercial carpet cleaning monument co',
        position: 99,
        impressions: 100,
        clicks: 0,
      },
    ]
    const panel = buildGoogleOrganicPanel(keywords, rows)
    expect(panel.series[0].points).toEqual([
      { date: '2026-09-28', rank: 3, status: 'ranked' },
    ])
    expect(panel.series[0].coverageLabel).toBe(
      '10 impressions · 1 measured week',
    )
    expect(panel.series[0].latestLabel).toContain('week of 09-28')
  })
  it('retains the first partial week and reports sparse coverage without filling gaps', () => {
    const panel = buildGoogleOrganicPanel(
      keywords,
      [
        {
          date: '2026-07-21',
          query: 'carpet cleaning monument co',
          position: 8,
          impressions: 1,
          clicks: 0,
        },
        {
          date: '2026-10-14',
          query: 'carpet cleaning monument co',
          position: 1,
          impressions: 1,
          clicks: 0,
        },
      ],
      new Date('2026-10-18T12:00:00Z'),
    )
    expect(panel.startDate).toBe('2026-07-20')
    expect(panel.series[0].points).toEqual([
      { date: '2026-07-20', rank: 8, status: 'ranked' },
      { date: '2026-10-12', rank: 1, status: 'ranked' },
    ])
    expect(panel.series[0].coverageLabel).toBe(
      '2 impressions · 2 measured weeks',
    )
    expect(panel.subtitle).toContain('town-named queries')
  })
  it('only confirms outside top 20 after 20 stored Maps results were checked', () => {
    const now = new Date('2026-10-18T12:00:00Z')
    const build = (depth?: number) =>
      buildMapsRankPanel(
        keywords,
        [
          {
            keyword_id: 'm',
            finder_rank: null,
            created_at: now.toISOString(),
            maps_checked_results: depth,
          },
        ],
        now,
      ).series[0]
    expect(build(3).points[0]).toMatchObject({
      status: 'unknown',
      depth: 3,
      rank: null,
    })
    expect(build(3).latestLabel).toContain(
      'Not returned in 3 checked Maps results',
    )
    expect(build(20).points[0]).toMatchObject({ status: 'outside', depth: 20 })
    expect(build(20).latestLabel).toContain('Outside top 20')
    expect(build().points[0].status).toBe('unknown')
    expect(build().latestLabel).toContain('Maps depth unavailable')
  })
  it('does not join old generic organic checks to the new qualified query', () => {
    expect(
      sameOrganicMethod(
        { version: 1 } as any,
        { version: 2, method: 'town-qualified-v2', query: 'x' } as any,
      ),
    ).toBe(false)
  })
})
