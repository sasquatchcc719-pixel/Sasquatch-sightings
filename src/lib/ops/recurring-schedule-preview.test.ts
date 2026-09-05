import { describe, expect, it } from 'vitest'
import { buildRecurringScheduleOccurrences } from './recurring-schedule-preview'

describe('buildRecurringScheduleOccurrences', () => {
  it('marks an overlapping appointment and leaves other visits clear', () => {
    const occurrences = buildRecurringScheduleOccurrences({
      dates: ['2026-09-11', '2026-09-18'],
      startTime: '09:00',
      durationMinutes: 120,
      appointments: [
        {
          appointment_date: '2026-09-11',
          start_time: '10:00:00',
          end_time: '12:00:00',
          ops_customers: {
            full_name: 'Existing Customer',
            business_name: null,
          },
        },
      ],
      events: [],
    })

    expect(occurrences).toEqual([
      expect.objectContaining({
        date: '2026-09-11',
        status: 'conflict',
        conflict: expect.objectContaining({
          source: 'appointment',
          label: 'Existing Customer',
        }),
      }),
      expect.objectContaining({ date: '2026-09-18', status: 'clear' }),
    ])
  })

  it('treats an all-day calendar event as a conflict', () => {
    const [occurrence] = buildRecurringScheduleOccurrences({
      dates: ['2026-09-11'],
      startTime: '18:00',
      durationMinutes: 180,
      appointments: [],
      events: [
        {
          title: 'Truck unavailable',
          event_kind: 'block',
          start_date: '2026-09-11',
          end_date: '2026-09-11',
          start_time: null,
          end_time: null,
          is_all_day: true,
          assigned_staff_user_id: null,
        },
      ],
    })

    expect(occurrence.status).toBe('conflict')
    expect(occurrence.conflict?.label).toBe('Truck unavailable')
  })
})
