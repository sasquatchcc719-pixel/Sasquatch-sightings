import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACTIVE_APPOINTMENT_STATUSES,
  addMinutesToTimeWithinDay,
  calendarEventsToAppointmentWindows,
  timeToMinutes,
} from '@/lib/ops/availability'

export type RecurringScheduleOccurrence = {
  date: string
  start_time: string
  end_time: string
  status: 'clear' | 'conflict'
  conflict: null | {
    source: 'appointment' | 'calendar_event'
    label: string
    start_time: string
    end_time: string
  }
}

type AppointmentRow = {
  appointment_date: string
  start_time: string
  end_time: string
  ops_customers:
    | { full_name: string | null; business_name: string | null }
    | Array<{ full_name: string | null; business_name: string | null }>
    | null
}

type CalendarEventRow = {
  title: string | null
  event_kind: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  assigned_staff_user_id: string | null
}

function overlaps(
  proposedStart: string,
  proposedEnd: string,
  busyStart: string,
  busyEnd: string,
): boolean {
  return (
    timeToMinutes(proposedStart) < timeToMinutes(busyEnd) &&
    timeToMinutes(busyStart) < timeToMinutes(proposedEnd)
  )
}

function customerLabel(row: AppointmentRow): string {
  const customer = Array.isArray(row.ops_customers)
    ? row.ops_customers[0]
    : row.ops_customers
  return (
    customer?.business_name || customer?.full_name || 'Existing appointment'
  )
}

export function buildRecurringScheduleOccurrences(params: {
  dates: string[]
  startTime: string
  durationMinutes: number
  appointments: AppointmentRow[]
  events: CalendarEventRow[]
}): RecurringScheduleOccurrence[] {
  const startTime = `${params.startTime}:00`.slice(0, 8)
  const endTime = addMinutesToTimeWithinDay(startTime, params.durationMinutes)

  return params.dates.map((date) => {
    const appointment = params.appointments.find(
      (row) =>
        row.appointment_date === date &&
        overlaps(startTime, endTime, row.start_time, row.end_time),
    )
    if (appointment) {
      return {
        date,
        start_time: startTime,
        end_time: endTime,
        status: 'conflict',
        conflict: {
          source: 'appointment',
          label: customerLabel(appointment),
          start_time: appointment.start_time,
          end_time: appointment.end_time,
        },
      }
    }

    for (const event of params.events) {
      const eventWindow = calendarEventsToAppointmentWindows(date, [event])[0]
      if (
        eventWindow &&
        overlaps(
          startTime,
          endTime,
          eventWindow.start_time,
          eventWindow.end_time,
        )
      ) {
        return {
          date,
          start_time: startTime,
          end_time: endTime,
          status: 'conflict',
          conflict: {
            source: 'calendar_event',
            label: event.title || event.event_kind || 'Calendar block',
            start_time: eventWindow.start_time,
            end_time: eventWindow.end_time,
          },
        }
      }
    }

    return {
      date,
      start_time: startTime,
      end_time: endTime,
      status: 'clear',
      conflict: null,
    }
  })
}

export async function previewRecurringSchedule(
  supabase: SupabaseClient,
  params: {
    dates: string[]
    startTime: string
    durationMinutes: number
    staffUserId: string
  },
): Promise<{
  staff: { id: string; display_name: string }
  occurrences: RecurringScheduleOccurrence[]
}> {
  const { data: staff, error: staffError } = await supabase
    .from('staff_users')
    .select('id, user_id, display_name')
    .eq('id', params.staffUserId)
    .eq('is_active', true)
    .maybeSingle()

  if (staffError) throw staffError
  if (!staff) throw new Error('Choose an active technician.')

  if (params.dates.length === 0) {
    return {
      staff: { id: staff.id, display_name: staff.display_name },
      occurrences: [],
    }
  }

  const startDate = params.dates[0]
  const endDate = params.dates[params.dates.length - 1]
  const staffEventFilters = [
    `assigned_staff_user_id.eq.${staff.id}`,
    staff.user_id ? `assigned_staff_user_id.eq.${staff.user_id}` : '',
    'assigned_staff_user_id.is.null',
  ]
    .filter(Boolean)
    .join(',')

  const [appointmentsResult, eventsResult] = await Promise.all([
    supabase
      .from('ops_appointments')
      .select(
        'appointment_date, start_time, end_time, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
      )
      .gte('appointment_date', startDate)
      .lte('appointment_date', endDate)
      .eq('is_subcontracted', false)
      .in('status', [...ACTIVE_APPOINTMENT_STATUSES])
      .or(
        `assigned_staff_user_id.eq.${staff.id},assigned_staff_user_id.is.null`,
      ),
    supabase
      .from('ops_calendar_events')
      .select(
        'title, event_kind, start_date, end_date, start_time, end_time, is_all_day, assigned_staff_user_id',
      )
      .lte('start_date', endDate)
      .gte('end_date', startDate)
      .or(staffEventFilters),
  ])

  if (appointmentsResult.error) throw appointmentsResult.error
  if (eventsResult.error) throw eventsResult.error

  return {
    staff: { id: staff.id, display_name: staff.display_name },
    occurrences: buildRecurringScheduleOccurrences({
      dates: params.dates,
      startTime: params.startTime,
      durationMinutes: params.durationMinutes,
      appointments: (appointmentsResult.data || []) as AppointmentRow[],
      events: (eventsResult.data || []) as CalendarEventRow[],
    }),
  }
}
