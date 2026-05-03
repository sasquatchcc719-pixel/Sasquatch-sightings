import { describe, expect, it } from 'vitest'
import {
  applyAppointmentBuffer,
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
})
