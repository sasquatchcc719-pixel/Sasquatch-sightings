import { describe, expect, it } from 'vitest'
import {
  getSemiMonthlyPayPeriod,
  mountainLocalDateTimeToIso,
  mountainDateKey,
  parseHourlyRate,
  shiftSemiMonthlyPayPeriod,
} from './timesheet-pay'

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

  it('converts Mountain daylight time to UTC', () => {
    expect(mountainLocalDateTimeToIso('2026-06-09', '16:44')).toBe(
      '2026-06-09T22:44:00.000Z',
    )
  })

  it('converts Mountain standard time to UTC', () => {
    expect(mountainLocalDateTimeToIso('2026-12-09', '16:44')).toBe(
      '2026-12-09T23:44:00.000Z',
    )
  })

  it('rejects nonexistent Mountain times during daylight saving transition', () => {
    expect(mountainLocalDateTimeToIso('2026-03-08', '02:30')).toBeNull()
  })

  it('groups dates into fixed semi-monthly pay periods', () => {
    expect(getSemiMonthlyPayPeriod('2026-06-08')).toEqual({
      startDate: '2026-06-01',
      endDate: '2026-06-15',
      label: '1st through 15th',
    })
    expect(getSemiMonthlyPayPeriod('2026-02-20')).toEqual({
      startDate: '2026-02-16',
      endDate: '2026-02-28',
      label: '16th through end of month',
    })
    expect(getSemiMonthlyPayPeriod('2024-02-20').endDate).toBe('2024-02-29')
  })

  it('moves between adjacent semi-monthly periods', () => {
    expect(shiftSemiMonthlyPayPeriod('2026-06-08', 1).startDate).toBe(
      '2026-06-16',
    )
    expect(shiftSemiMonthlyPayPeriod('2026-06-20', 1).startDate).toBe(
      '2026-07-01',
    )
    expect(shiftSemiMonthlyPayPeriod('2026-06-08', -1).startDate).toBe(
      '2026-05-16',
    )
    expect(shiftSemiMonthlyPayPeriod('2026-12-20', 1).startDate).toBe(
      '2026-12-25',
    )
  })
})

describe('October 2026 payroll schedule change', () => {
  it.each([
    ['2026-10-01', '2026-10-01', '2026-10-10', 'Transition: 1st through 10th'],
    ['2026-10-10', '2026-10-01', '2026-10-10', 'Transition: 1st through 10th'],
    ['2026-10-11', '2026-10-11', '2026-10-24', '11th through 24th'],
    ['2026-10-24', '2026-10-11', '2026-10-24', '11th through 24th'],
    ['2026-10-25', '2026-10-25', '2026-11-10', '25th through 10th'],
    ['2026-11-10', '2026-10-25', '2026-11-10', '25th through 10th'],
    ['2026-11-11', '2026-11-11', '2026-11-24', '11th through 24th'],
    ['2026-12-31', '2026-12-25', '2027-01-10', '25th through 10th'],
    ['2027-01-01', '2026-12-25', '2027-01-10', '25th through 10th'],
    ['2028-02-29', '2028-02-25', '2028-03-10', '25th through 10th'],
  ])(
    'assigns %s to the correct inclusive period',
    (date, startDate, endDate, label) => {
      expect(getSemiMonthlyPayPeriod(date)).toEqual({
        startDate,
        endDate,
        label,
      })
    },
  )

  it('navigates every period without gaps, overlaps, or changing historical payroll', () => {
    let period = getSemiMonthlyPayPeriod('2026-09-16')
    expect(period.endDate).toBe('2026-09-30')
    for (let index = 0; index < 40; index++) {
      const next = shiftSemiMonthlyPayPeriod(period.startDate, 1)
      const nextDay = new Date(`${period.endDate}T12:00:00Z`)
      nextDay.setUTCDate(nextDay.getUTCDate() + 1)
      expect(next.startDate).toBe(nextDay.toISOString().slice(0, 10))
      expect(shiftSemiMonthlyPayPeriod(next.startDate, -1)).toEqual(period)
      for (
        let day = new Date(`${next.startDate}T12:00:00Z`);
        day.toISOString().slice(0, 10) <= next.endDate;
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        expect(getSemiMonthlyPayPeriod(day.toISOString().slice(0, 10))).toEqual(
          next,
        )
      }
      period = next
    }
  })
})
