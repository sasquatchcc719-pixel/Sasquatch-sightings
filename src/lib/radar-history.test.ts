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
    expect(panel.series[0].latestLabel).toContain('10 views')
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
