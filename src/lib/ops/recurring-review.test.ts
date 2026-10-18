import { describe, expect, it } from 'vitest'
import {
  parseRecurringOverrides,
  recurringReviewMatches,
  freezeRecurringVisits,
  validRecurringDate,
} from './recurring-review'
import type { RecurringScheduleOccurrence } from './recurring-scheduling'
const visits: RecurringScheduleOccurrence[] = [
  {
    original_date: '2026-10-19',
    date: '2026-10-20',
    start_time: '13:00:00',
    end_time: '15:00:00',
    status: 'clear',
    shifted: true,
    reason: 'Next opening',
    alternatives: [],
    conflict: null,
  },
]
describe('reviewed recurring dates', () => {
  it('accepts the exact preview, normalizing clock precision', () => {
    expect(
      recurringReviewMatches(
        [{ ...visits[0], start_time: '13:00', end_time: '15:00' }],
        visits,
      ),
    ).toBe(true)
    expect(freezeRecurringVisits(visits, {})).toEqual({
      '2026-10-19': { date: '2026-10-20', start_time: '13:00' },
    })
  })
  it('rejects stale dates, unresolved conflicts and incomplete reviews', () => {
    expect(
      recurringReviewMatches([{ ...visits[0], date: '2026-10-19' }], visits),
    ).toBe(false)
    expect(
      recurringReviewMatches(visits, [{ ...visits[0], status: 'conflict' }]),
    ).toBe(false)
    expect(recurringReviewMatches([], visits)).toBe(false)
    expect(recurringReviewMatches([null], visits)).toBe(false)
    expect(recurringReviewMatches(visits, [])).toBe(false)
  })
  it('validates actual calendar dates and per-visit start times', () => {
    expect(validRecurringDate('2026-99-99')).toBe(false)
    expect(validRecurringDate('2026-02-30')).toBe(false)
    expect(() =>
      parseRecurringOverrides({
        '2026-10-19': { date: '2026-10-20', start_time: '24:30' },
      }),
    ).toThrow()
    expect(() => parseRecurringOverrides([])).toThrow()
    expect(
      parseRecurringOverrides({
        '2026-10-19': { date: '2026-10-20', start_time: '13:00:00' },
      }),
    ).toEqual({ '2026-10-19': { date: '2026-10-20', start_time: '13:00' } })
  })
})
