import { describe, expect, it } from 'vitest'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  type ExistingAppointmentWindow,
} from './availability'
import {
  selectStaffForStartTime,
  type StaffSlotResult,
} from './staff-availability'

/**
 * Regression: the public booking widget offered every time ANY tech was free
 * for (getUnionedSlots), but the booking POST validated the request against
 * only the first tech who had any opening at all (getStaffPrioritizedSlots).
 * A customer who picked a time the top-priority tech was busy for got
 * "That time is no longer available" for a slot that was genuinely bookable.
 */

const DATE = '2026-09-08' // Tuesday

function slotsFor(busy: ExistingAppointmentWindow[], requiredMinutes: number) {
  return getAvailableSlots({
    date: DATE,
    requiredMinutes,
    templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
    overrides: [],
    appointments: busy,
    maxResults: 48,
  })
}

function busyWindow(start: string, end: string): ExistingAppointmentWindow {
  return {
    appointment_date: DATE,
    start_time: start,
    end_time: end,
    status: 'booked',
  }
}

/** Staff in scheduling_priority order, as getAllStaffSlots returns them. */
function staffSlots(requiredMinutes: number): StaffSlotResult[] {
  return [
    {
      // Priority 0 — booked solid through the morning.
      staffUserId: 'staff-first',
      staffName: 'First Tech',
      slots: slotsFor([busyWindow('09:00:00', '13:00:00')], requiredMinutes),
    },
    {
      // Priority 10 — wide open.
      staffUserId: 'staff-second',
      staffName: 'Second Tech',
      slots: slotsFor([], requiredMinutes),
    },
  ]
}

describe('selectStaffForStartTime', () => {
  const requiredMinutes = applyAppointmentBuffer(
    calculateAppointmentDurationFromTotal(250),
  )

  it('books a morning slot only the lower-priority tech is free for', () => {
    const staff = staffSlots(requiredMinutes)

    // The first tech is busy 09:00-13:00, so 09:00 is offered purely because
    // the second tech is free. The booking must succeed and route to them.
    expect(staff[0].slots.map((s) => s.start_time)).not.toContain('09:00:00')

    const match = selectStaffForStartTime(staff, '09:00:00')
    expect(match?.staffUserId).toBe('staff-second')
  })

  it('accepts every start time the widget was allowed to offer', () => {
    const staff = staffSlots(requiredMinutes)

    // Exactly what /api/public/availability publishes: the union of all techs.
    const offered = Array.from(
      new Set(staff.flatMap((s) => s.slots.map((slot) => slot.start_time))),
    )
    expect(offered.length).toBeGreaterThan(0)

    const rejected = offered.filter(
      (start) => selectStaffForStartTime(staff, start) === null,
    )
    expect(rejected).toEqual([])
  })

  it('prefers the higher-priority tech when both are free', () => {
    const match = selectStaffForStartTime(
      staffSlots(requiredMinutes),
      '15:00:00',
    )
    expect(match?.staffUserId).toBe('staff-first')
  })

  it('rejects a time no tech is free for', () => {
    const staff: StaffSlotResult[] = [
      {
        staffUserId: 'staff-first',
        staffName: 'First Tech',
        slots: slotsFor([busyWindow('09:00:00', '17:00:00')], requiredMinutes),
      },
    ]
    expect(selectStaffForStartTime(staff, '09:00:00')).toBeNull()
  })

  it('matches HH:MM and unpadded starts the same as HH:MM:SS', () => {
    const staff = staffSlots(requiredMinutes)
    expect(selectStaffForStartTime(staff, '09:00')?.staffUserId).toBe(
      'staff-second',
    )
    expect(selectStaffForStartTime(staff, '9:00')?.staffUserId).toBe(
      'staff-second',
    )
  })

  it('rejects an unparseable start time instead of matching one', () => {
    expect(selectStaffForStartTime(staffSlots(requiredMinutes), '')).toBeNull()
    expect(
      selectStaffForStartTime(staffSlots(requiredMinutes), 'not-a-time'),
    ).toBeNull()
  })

  it('validates long jobs against the whole day, not a truncated list', () => {
    // A $601+ job needs a 4-hour window; the only one left is late in the day.
    const longJobMinutes = applyAppointmentBuffer(
      calculateAppointmentDurationFromTotal(700),
    )
    const staff: StaffSlotResult[] = [
      {
        staffUserId: 'staff-first',
        staffName: 'First Tech',
        slots: slotsFor([busyWindow('09:00:00', '13:00:00')], longJobMinutes),
      },
    ]
    expect(selectStaffForStartTime(staff, '13:00:00')?.staffUserId).toBe(
      'staff-first',
    )
  })
})
