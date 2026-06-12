import { describe, expect, it } from 'vitest'
import {
  getMountainDateKey,
  getTechAppointmentPlacement,
  shiftDateKey,
} from './day-schedule'

describe('tech day schedule', () => {
  it('positions appointments on the same 84px-per-hour grid as the admin day view', () => {
    expect(getTechAppointmentPlacement('09:30:00', '11:00:00')).toEqual({
      top: 210,
      height: 126,
    })
  })

  it('gives appointments with no end time a one-hour block', () => {
    expect(getTechAppointmentPlacement('10:00:00', null)).toEqual({
      top: 252,
      height: 84,
    })
  })

  it('returns null for jobs without a scheduled start time', () => {
    expect(getTechAppointmentPlacement(null, null)).toBeNull()
  })

  it('shifts date keys without local timezone drift', () => {
    expect(shiftDateKey('2026-06-01', -1)).toBe('2026-05-31')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('uses the Mountain Time calendar date', () => {
    expect(getMountainDateKey(new Date('2026-06-13T05:30:00Z'))).toBe(
      '2026-06-12',
    )
  })
})
