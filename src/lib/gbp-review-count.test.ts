import { describe, expect, it } from 'vitest'
import { formatReviewCountChange } from './gbp-review-count'

describe('formatReviewCountChange', () => {
  it('stays quiet when the count did not move', () => {
    expect(
      formatReviewCountChange(
        { today: 79, previous: 79, delta: 0, previousDate: '2026-07-27' },
        81,
      ),
    ).toBeNull()
  })

  it('stays quiet on the first ever snapshot (nothing to compare)', () => {
    expect(
      formatReviewCountChange(
        { today: 79, previous: null, delta: null, previousDate: null },
        81,
      ),
    ).toBeNull()
  })

  it('announces a recovery and how many are still hidden', () => {
    const text = formatReviewCountChange(
      { today: 79, previous: 2, delta: 77, previousDate: '2026-07-27' },
      81,
    )
    expect(text).toContain('up 77')
    expect(text).toContain('Now showing 79 (was 2)')
    expect(text).toContain('2 still not public')
  })

  it('announces a drop, which is what a suspension looks like', () => {
    const text = formatReviewCountChange(
      { today: 2, previous: 79, delta: -77, previousDate: '2026-07-27' },
      81,
    )
    expect(text).toContain('down 77')
    expect(text).toContain('Now showing 2 (was 79)')
  })

  it('omits the archive line once Google is showing everything we have', () => {
    const text = formatReviewCountChange(
      { today: 82, previous: 81, delta: 1, previousDate: '2026-07-27' },
      81,
    )
    expect(text).not.toContain('not public')
  })
})
