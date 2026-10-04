export type CalendarEventRange = {
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
}

export type CalendarEventDayWindow = {
  start_time: string
  end_time: string
  is_full_day: boolean
}

const DAY_START = '00:00:00'
const DAY_END = '23:59:59'

/**
 * Resolve one continuous calendar-event range into the portion that applies
 * to a particular date. The first and last days keep their respective times;
 * every day between them is fully blocked.
 */
export function calendarEventWindowForDate(
  event: CalendarEventRange,
  date: string,
): CalendarEventDayWindow | null {
  if (date < event.start_date || date > event.end_date) return null

  if (event.is_all_day || !event.start_time || !event.end_time) {
    return {
      start_time: DAY_START,
      end_time: DAY_END,
      is_full_day: true,
    }
  }

  if (event.start_date === event.end_date) {
    return {
      start_time: event.start_time,
      end_time: event.end_time,
      is_full_day: false,
    }
  }

  const startsBeforeThisDay = date > event.start_date
  const endsAfterThisDay = date < event.end_date
  return {
    start_time: startsBeforeThisDay ? DAY_START : event.start_time,
    end_time: endsAfterThisDay ? DAY_END : event.end_time,
    is_full_day: startsBeforeThisDay && endsAfterThisDay,
  }
}

export function calendarEventRangeError(
  event: CalendarEventRange,
): string | null {
  if (event.end_date < event.start_date) {
    return 'End date must be on or after start date'
  }

  if (event.is_all_day) return null

  if (!event.start_time || !event.end_time) {
    return 'Provide both start_time and end_time or choose all day'
  }

  if (
    event.start_date === event.end_date &&
    event.end_time <= event.start_time
  ) {
    return 'End time must be after start time for a single-day block'
  }

  return null
}
