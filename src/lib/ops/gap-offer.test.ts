// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertSupportedGapEstimate } from './gap-offer'
describe('TF35 saved estimate boundary', () => {
  it('rejects the coupon in a line label, line notes, or saved internal notes', () => {
    for (const [lines, notes] of [
      [[{ name_snapshot: 'Carpet TF35' }], ''],
      [[{ notes: 'tf35 applied' }], ''],
      [[], 'Offer TF35'],
    ] as const) {
      expect(() => assertSupportedGapEstimate([...lines], notes)).toThrow(
        'generic saved/emailed estimates',
      )
    }
  })
  it('permits ordinary saved quotes without introducing a discount', () => {
    expect(() =>
      assertSupportedGapEstimate(
        [{ name_snapshot: 'Carpet', notes: 'Two rooms' }],
        '',
      ),
    ).not.toThrow()
  })
  it('allows an explicit offer context to proceed to the separate live validation', () => {
    expect(() =>
      assertSupportedGapEstimate([{ name_snapshot: 'Carpet TF35' }], '', true),
    ).not.toThrow()
  })
})
