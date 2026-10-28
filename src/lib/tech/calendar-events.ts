import type { createAdminClient } from '@/supabase/server'
import { calendarEventWindowForDate } from '@/lib/ops/calendar-event-range'

export type TechCalendarEvent = {
  id: string
  title: string
  description: string | null
  startTime: string
  endTime: string
  isAllDay: boolean
}

export async function getTechCalendarEvents(
  supabase: ReturnType<typeof createAdminClient>,
  staffUserId: string,
  authUserId: string,
  date: string,
): Promise<TechCalendarEvent[]> {
  const staffIds = [...new Set([staffUserId, authUserId])]
  const { data, error } = await supabase
    .from('ops_calendar_events')
    .select(
      'id, title, description, start_date, end_date, start_time, end_time, is_all_day',
    )
    .lte('start_date', date)
    .gte('end_date', date)
    .or(
      [
        ...staffIds.map((id) => `assigned_staff_user_id.eq.${id}`),
        'assigned_staff_user_id.is.null',
      ].join(','),
    )
    .order('start_date')
    .order('start_time')

  if (error) throw error
  return (data ?? []).flatMap((event) => {
    const window = calendarEventWindowForDate(event, date)
    return window
      ? [
          {
            id: event.id,
            title: event.title,
            description: event.description,
            startTime: window.start_time,
            endTime: window.end_time,
            isAllDay: window.is_full_day,
          },
        ]
      : []
  })
}
