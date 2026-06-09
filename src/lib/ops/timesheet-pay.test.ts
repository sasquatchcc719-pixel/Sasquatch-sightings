import { describe, expect, it } from 'vitest'
import { mountainDateKey, parseHourlyRate } from './timesheet-pay'

describe('parseHourlyRate', () => {
  it('accepts and rounds a valid hourly rate', () => {
    expect(parseHourlyRate('22.555')).toBe(22.56)
  })

  it.each([0, -1, '', 'not a number', 1000.01])(
    'rejects invalid hourly rate %s',
    (value) => {
      expect(parseHourlyRate(value)).toBeNull()
    },
  )

  it('uses the Mountain Time calendar date', () => {
    expect(mountainDateKey('2026-06-09T03:00:00.000Z')).toBe('2026-06-08')
  })
})
