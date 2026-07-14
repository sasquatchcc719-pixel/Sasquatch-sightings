import { describe, expect, it } from 'vitest'
import {
  applyAppointmentBuffer,
  calculateAppointmentDurationFromTotal,
  calendarEventsToAppointmentWindows,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
} from './availability'

describe('availability gap fill', () => {
  it('keeps three-hour jobs at three hours', () => {
    expect(applyAppointmentBuffer(180)).toBe(180)
  })

  it('offers the earliest three-hour gap between existing jobs', () => {
    const slots = getAvailableSlots({
      date: '2026-05-04',
      requiredMinutes: applyAppointmentBuffer(180),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: [
        {
          appointment_date: '2026-05-04',
          start_time: '09:00:00',
          end_time: '11:00:00',
          status: 'booked',
        },
        {
          appointment_date: '2026-05-04',
          start_time: '11:00:00',
          end_time: '14:00:00',
          status: 'booked',
        },
        {
          appointment_date: '2026-05-04',
          start_time: '18:00:00',
          end_time: '22:00:00',
          status: 'booked',
        },
      ],
      maxResults: 1,
    })

    expect(slots).toEqual([
      {
        start_time: '14:00:00',
        end_time: '17:00:00',
      },
    ])
  })

  it('does not offer a 2-hour gap to a dollar-sized 4-hour job (double-book guard)', () => {
    // A $601+ job stores a 4-hour block on the server (dollar tiers). The admin
    // picker must size availability by that same block, or it will offer the
    // 09:00 gap in front of an 11:00 appointment and double-book the tech.
    const requiredMinutes = applyAppointmentBuffer(
      calculateAppointmentDurationFromTotal(650),
    )
    expect(requiredMinutes).toBe(240)

    const slots = getAvailableSlots({
      date: '2026-05-04',
      requiredMinutes,
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: [
        {
          appointment_date: '2026-05-04',
          start_time: '11:00:00',
          end_time: '13:00:00',
          status: 'booked',
        },
      ],
      maxResults: 8,
    })

    // The only opening long enough for 4 hours starts at 13:00 (13:00–17:00).
    // 09:00 must NOT appear — it would run to 13:00 and collide with the 11:00.
    expect(slots.every((slot) => slot.start_time !== '09:00:00')).toBe(true)
    expect(slots).toEqual([
      {
        start_time: '13:00:00',
        end_time: '17:00:00',
      },
    ])
  })

  it('blocks an entire day for all-day calendar events', () => {
    const date = '2026-05-16'
    const blockedWindows = calendarEventsToAppointmentWindows(date, [
      {
        start_date: '2026-05-14',
        end_date: '2026-05-16',
        start_time: null,
        end_time: null,
        is_all_day: true,
        event_kind: 'block',
      },
    ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes: applyAppointmentBuffer(120),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: blockedWindows,
    })

    expect(slots).toEqual([])
  })

  it('blocks only overlapping slots for timed calendar events', () => {
    const date = '2026-05-07'
    const blockedWindows = calendarEventsToAppointmentWindows(date, [
      {
        start_date: date,
        end_date: date,
        start_time: '09:00:00',
        end_time: '11:00:00',
        is_all_day: false,
        event_kind: 'block',
      },
    ])

    const slots = getAvailableSlots({
      date,
      requiredMinutes: applyAppointmentBuffer(120),
      templates: DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
      overrides: [],
      appointments: blockedWindows,
    })

    expect(slots[0]).toEqual({
      start_time: '11:00:00',
      end_time: '13:00:00',
    })
  })
})
