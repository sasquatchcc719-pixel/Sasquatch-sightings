import { describe, expect, it } from 'vitest'
import {
  applyAppointmentBuffer,
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
