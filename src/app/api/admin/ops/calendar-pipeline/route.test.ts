import { describe, expect, it } from 'vitest'
import { addOneCalendarYear, mountainDateKey } from './route'

describe('calendar pipeline rolling window', () => {
  it('ends on the same calendar date next year', () => {
    expect(addOneCalendarYear('2026-09-29')).toBe('2027-09-29')
  })

  it('clamps leap day to the last day of February', () => {
    expect(addOneCalendarYear('2028-02-29')).toBe('2029-02-28')
  })

  it('uses the Mountain business date around UTC midnight', () => {
    expect(mountainDateKey(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-31')
  })
})
