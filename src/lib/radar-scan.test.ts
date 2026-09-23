import { describe, expect, it } from 'vitest'
import { rollingMedianRank } from './radar-scan'

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
