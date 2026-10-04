import { describe, expect, it } from 'vitest'
import {
  calendarEventRangeError,
  calendarEventWindowForDate,
} from './calendar-event-range'

const multiDayBlock = {
  start_date: '2026-10-05',
  end_date: '2026-10-08',
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_all_day: false,
}

describe('calendarEventWindowForDate', () => {
  it('keeps the selected start time on the first day', () => {
    expect(calendarEventWindowForDate(multiDayBlock, '2026-10-05')).toEqual({
      start_time: '09:00:00',
      end_time: '23:59:59',
      is_full_day: false,
    })
  })

  it('fully blocks every day between the endpoints', () => {
    expect(calendarEventWindowForDate(multiDayBlock, '2026-10-06')).toEqual({
      start_time: '00:00:00',
      end_time: '23:59:59',
      is_full_day: true,
    })
  })

  it('keeps the selected end time on the final day', () => {
    expect(calendarEventWindowForDate(multiDayBlock, '2026-10-08')).toEqual({
      start_time: '00:00:00',
      end_time: '17:00:00',
      is_full_day: false,
    })
  })

  it('does not block dates outside the selected range', () => {
    expect(calendarEventWindowForDate(multiDayBlock, '2026-10-09')).toBeNull()
  })
})

describe('calendarEventRangeError', () => {
  it('allows an end clock time earlier than the start clock time across dates', () => {
    expect(
      calendarEventRangeError({
        ...multiDayBlock,
        start_time: '17:00:00',
        end_time: '09:00:00',
      }),
    ).toBeNull()
  })

  it('rejects the same clock range on one date', () => {
    expect(
      calendarEventRangeError({
        ...multiDayBlock,
        end_date: multiDayBlock.start_date,
        start_time: '17:00:00',
        end_time: '09:00:00',
      }),
    ).toBe('End time must be after start time for a single-day block')
  })
})
