import { describe, expect, it } from 'vitest'
import { buildRecurringScheduleOccurrences } from './recurring-schedule-preview'
import {
  moveRecurringDateToWeekday,
  previewDateDetails,
  type RecurrenceRule,
} from './recurring'

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

describe('recurring weekday scheduling', () => {
  it('moves Saturday and Sunday to the following Monday', () => {
    expect(moveRecurringDateToWeekday('2026-11-14')).toBe('2026-11-16')
    expect(moveRecurringDateToWeekday('2026-11-15')).toBe('2026-11-16')
    expect(moveRecurringDateToWeekday('2026-11-16')).toBe('2026-11-16')
  })

  it('shows the original and shifted dates in recurring previews', () => {
    const rule: RecurrenceRule = {
      id: 'rule-a',
      template_id: 'template-a',
      frequency: 'monthly',
      day_of_week: null,
      week_of_month: null,
      day_of_month: 15,
      interval_days: null,
      effective_from: '2026-11-01',
      effective_until: null,
      override_start_time: null,
    }

    expect(
      previewDateDetails([rule], 1, new Date('2026-11-01T00:00:00')),
    ).toEqual([
      {
        original_date: '2026-11-15',
        date: '2026-11-16',
        shifted: true,
      },
    ])
  })
})
