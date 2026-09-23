import { describe, expect, it } from 'vitest'
import { buildWeeklyMapsVisibility, rollingMedianRank } from './radar-scan'

describe('rollingMedianRank', () => {
  it('does not turn one bad sample into an unranked alert', () => {
    expect(rollingMedianRank([null, 4, 3], 51)).toBe(4)
  })

  it('confirms an unranked state after two consecutive misses', () => {
    expect(rollingMedianRank([null, null, 4], 51)).toBeNull()
  })

  it('preserves a genuine rank 50', () => {
    expect(rollingMedianRank([50, 50, null], 51)).toBe(50)
  })

  it('uses the latest raw value while a new provider baseline forms', () => {
    expect(rollingMedianRank([16], 51)).toBe(16)
    expect(rollingMedianRank([18, 16], 51)).toBe(18)
  })
})

describe('buildWeeklyMapsVisibility', () => {
  it('builds comparable weekly history and omits incomplete weeks', () => {
    const row = (
      keyword_id: string,
      created_at: string,
      finder_rank: number | null,
    ) => ({ keyword_id, created_at, finder_rank })

    expect(
      buildWeeklyMapsVisibility(
        [
          // Pre-fixed-coordinate history must not be mixed into the graph.
          row('a', '2026-08-09T12:00:00Z', 1),
          row('b', '2026-08-09T12:00:00Z', 1),
          row('a', '2026-08-10T12:00:00Z', 1),
          row('a', '2026-08-11T12:00:00Z', 3),
          row('b', '2026-08-10T12:00:00Z', null),
          row('b', '2026-08-11T12:00:00Z', null),
          row('a', '2026-08-17T12:00:00Z', null),
          row('b', '2026-08-17T12:00:00Z', 10),
          // Incomplete week: keyword b never ran, so this is not comparable.
          row('a', '2026-08-24T12:00:00Z', 2),
        ],
        ['a', 'b'],
      ),
    ).toEqual([
      { label: 'Aug 10', value: 1 },
      { label: 'Aug 17', value: 1 },
    ])
  })
})
