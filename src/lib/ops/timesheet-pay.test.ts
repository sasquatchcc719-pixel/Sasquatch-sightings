import { describe, expect, it } from 'vitest'
import { parseHourlyRate } from './timesheet-pay'

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
})
