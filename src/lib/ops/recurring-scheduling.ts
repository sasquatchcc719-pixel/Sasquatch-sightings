import type { SupabaseClient } from '@supabase/supabase-js'
import { mountainDateKey } from '@/lib/ops/calendar-dates'
import {
  ACTIVE_APPOINTMENT_STATUSES,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  calendarEventsToAppointmentWindows,
  getAvailableSlots,
  timeToMinutes,
  type AvailabilityOverride,
  type AvailabilityTemplate,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'

export type RecurringSchedulingMode = 'fixed' | 'flexible'
export type RecurringVisitOverrides = Record<
  string,
  { date: string; start_time: string }
>
export type RecurringCandidate = {
  original_date: string
  date: string
  start_time: string
  /** Retained when a preview is sliced, so its final visit cannot cross the next due date. */
  next_original_date?: string
}
export type RecurringScheduleAlternative = {
  date: string
  start_time: string
  end_time: string
}
export type RecurringScheduleOccurrence = RecurringScheduleAlternative & {
  original_date: string
  status: 'clear' | 'conflict'
  shifted: boolean
  reason: string | null
  alternatives: RecurringScheduleAlternative[]
  conflict: null | {
    source: 'appointment' | 'calendar_event'
    label: string
    start_time: string
    end_time: string
  }
}
export type RecurringSchedulePlanInput = {
  candidates: RecurringCandidate[]
  staffUserId: string
  durationMinutes: number
  schedulingMode?: RecurringSchedulingMode
  visitOverrides?: RecurringVisitOverrides | null
  excludeTemplateId?: string
}

type Appointment = ExistingAppointmentWindow & {
  recurring_template_id: string | null
  ops_customers?:
    | { full_name?: string | null; business_name?: string | null }
    | { full_name?: string | null; business_name?: string | null }[]
    | null
}
type Template = AvailabilityTemplate & { staff_user_id?: string | null }
type Override = AvailabilityOverride & { staff_user_id?: string | null }
type Event = {
  title: string | null
  event_kind: string | null
  start_date: string
  end_date: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  assigned_staff_user_id: string | null
}

function addDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
    addDays(date, 0) === date
  )
}
function normalizedTime(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(time))
    throw new Error('Each recurring visit needs a valid start time.')
  return `${time.slice(0, 5)}:00`
}
function minutesToTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
}
function overlaps(
  start: string,
  end: string,
  busyStart: string,
  busyEnd: string,
) {
  return (
    timeToMinutes(start) < timeToMinutes(busyEnd) &&
    timeToMinutes(busyStart) < timeToMinutes(end)
  )
}

/** The same read-only occurrence planner is used by previews and flexible generation. */
export async function planRecurringSchedule(
  supabase: SupabaseClient,
  input: RecurringSchedulePlanInput,
): Promise<{
  staff: { id: string; display_name: string }
  occurrences: RecurringScheduleOccurrence[]
}> {
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes > 24 * 60
  )
    throw new Error('Recurring visit duration must fit within one day.')
  const now = new Date()
  const today = mountainDateKey(now)
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now)
  const clockPart = (type: string) =>
    Number(clock.find((part) => part.type === type)?.value || 0)
  const earliestToday = Math.ceil(
    (clockPart('hour') * 3600 +
      clockPart('minute') * 60 +
      clockPart('second')) /
      60,
  )
  const candidates = [...input.candidates].sort((a, b) =>
    a.original_date.localeCompare(b.original_date),
  )
  for (const candidate of candidates) {
    if (
      !validDate(candidate.original_date) ||
      !validDate(candidate.date) ||
      (candidate.next_original_date && !validDate(candidate.next_original_date))
    )
      throw new Error('Each recurring visit needs a valid date.')
    normalizedTime(candidate.start_time)
  }
  const [staffResult, templatesResult] = await Promise.all([
    supabase
      .from('staff_users')
      .select('id, user_id, display_name, default_open')
      .eq('id', input.staffUserId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('availability_templates')
      .select('*')
      .eq('is_active', true)
      .or(`staff_user_id.eq.${input.staffUserId},staff_user_id.is.null`),
  ])
  if (staffResult.error) throw staffResult.error
  if (templatesResult.error) throw templatesResult.error
  const staffRecord = staffResult.data
  if (!staffRecord) throw new Error('Choose an active technician.')
  const staff = { ...staffRecord }
  const result = {
    staff: { id: staff.id, display_name: staff.display_name },
    occurrences: [] as RecurringScheduleOccurrence[],
  }
  if (!candidates.length) return result

  const startDate = candidates[0].original_date
  const endDate = addDays(candidates[candidates.length - 1].original_date, 14)
  const staffEvents = [
    `assigned_staff_user_id.eq.${staff.id}`,
    staff.user_id ? `assigned_staff_user_id.eq.${staff.user_id}` : '',
    'assigned_staff_user_id.is.null',
  ]
    .filter(Boolean)
    .join(',')
  const [dailyResult, overridesResult, appointmentsResult, eventsResult] =
    await Promise.all([
      supabase
        .from('staff_daily_availability')
        .select('date, is_open')
        .eq('staff_user_id', staff.id)
        .gte('date', startDate)
        .lte('date', endDate),
      supabase
        .from('availability_overrides')
        .select('*')
        .gte('override_date', startDate)
        .lte('override_date', endDate)
        .or(`staff_user_id.eq.${staff.id},staff_user_id.is.null`),
      supabase
        .from('ops_appointments')
        .select(
          'appointment_date, start_time, end_time, status, recurring_template_id, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
        )
        .gte('appointment_date', startDate)
        .lte('appointment_date', endDate)
        .eq('is_subcontracted', false)
        .in('status', [...ACTIVE_APPOINTMENT_STATUSES, 'pending_approval'])
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
        .or(staffEvents),
    ])
  for (const query of [
    dailyResult,
    overridesResult,
    appointmentsResult,
    eventsResult,
  ])
    if (query.error) throw query.error
  const configured = (templatesResult.data || []) as Template[]
  const staffTemplates = configured.filter(
    (row) => row.staff_user_id === staff.id,
  )
  const templates = staffTemplates.length
    ? staffTemplates
    : configured.length
      ? configured
      : DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES
  const daily = new Map(
    (dailyResult.data || []).map((row) => [row.date, row.is_open]),
  )
  const overrides = (overridesResult.data || []) as Override[]
  const appointments = ((appointmentsResult.data || []) as Appointment[])
    .filter(
      (row) =>
        !input.excludeTemplateId ||
        row.recurring_template_id !== input.excludeTemplateId,
    )
    .map((row) =>
      row.status === 'pending_approval' ? { ...row, status: 'booked' } : row,
    )
  const events = (eventsResult.data || []) as Event[]
  const reservations: Appointment[] = []
  const cache = new Map<
    string,
    {
      open: boolean
      templates: AvailabilityTemplate[]
      overrides: Override[]
      appointments: Appointment[]
      eventWindows: ReturnType<typeof calendarEventsToAppointmentWindows>
    }
  >()

  function day(date: string) {
    let cached = cache.get(date)
    if (cached) return cached
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay()
    const dateOverrides = overrides.filter((row) => row.override_date === date)
    // Global blocks still apply when a technician also has an override that day.
    const effectiveOverrides = dateOverrides
    const dayTemplates = templates.filter(
      (row) => row.is_active && row.day_of_week === dayOfWeek,
    )
    for (const override of effectiveOverrides) {
      if (override.is_available && override.start_time && override.end_time)
        dayTemplates.push({
          day_of_week: dayOfWeek,
          start_time: override.start_time,
          end_time: override.end_time,
          slot_interval_minutes: 30,
          is_active: true,
        })
    }
    cached = {
      open:
        date >= today &&
        dayOfWeek !== 0 &&
        dayOfWeek !== 6 &&
        (daily.get(date) ?? staff.default_open !== false),
      templates: dayTemplates,
      overrides: effectiveOverrides,
      appointments: appointments.filter((row) => row.appointment_date === date),
      eventWindows: calendarEventsToAppointmentWindows(date, events),
    }
    cache.set(date, cached)
    return cached
  }
  function windows(date: string) {
    const bundle = day(date)
    return [
      ...bundle.appointments,
      ...reservations.filter((row) => row.appointment_date === date),
      ...bundle.eventWindows,
    ]
  }
  function check(
    date: string,
    startTime: string,
  ): {
    clear: boolean
    reason: string | null
    conflict: RecurringScheduleOccurrence['conflict']
    endTime: string
  } {
    const start = timeToMinutes(startTime)
    const endTime = minutesToTime(start + input.durationMinutes)
    const bundle = day(date)
    const closed = {
      clear: false,
      reason:
        'The technician is unavailable or this visit does not fit within working hours.',
      conflict: null,
      endTime,
    }
    if (date < today || (date === today && start < earliestToday))
      return {
        ...closed,
        reason: 'Choose a future start time in Mountain time.',
      }
    if (
      !bundle.open ||
      start + input.durationMinutes > 24 * 60 ||
      !bundle.templates.some(
        (row) =>
          start >= timeToMinutes(row.start_time) &&
          start + input.durationMinutes <= timeToMinutes(row.end_time),
      )
    )
      return closed
    if (
      bundle.overrides.some(
        (row) =>
          !row.is_available &&
          (!row.start_time ||
            !row.end_time ||
            overlaps(startTime, endTime, row.start_time, row.end_time)),
      )
    )
      return closed
    const appointment = [...bundle.appointments, ...reservations].find(
      (row) =>
        row.appointment_date === date &&
        overlaps(startTime, endTime, row.start_time, row.end_time),
    )
    if (appointment) {
      const customer = Array.isArray(appointment.ops_customers)
        ? appointment.ops_customers[0]
        : appointment.ops_customers
      return {
        clear: false,
        reason: 'The preferred visit overlaps existing work.',
        endTime,
        conflict: {
          source: 'appointment',
          label:
            customer?.business_name ||
            customer?.full_name ||
            'Existing appointment',
          start_time: appointment.start_time,
          end_time: appointment.end_time,
        },
      }
    }
    const event = events.find((row) => {
      const window = calendarEventsToAppointmentWindows(date, [row])[0]
      return (
        window &&
        overlaps(startTime, endTime, window.start_time, window.end_time)
      )
    })
    if (event)
      return {
        clear: false,
        reason: 'The preferred visit overlaps blocked calendar time.',
        endTime,
        conflict: {
          source: 'calendar_event',
          label: event.title || event.event_kind || 'Calendar block',
          start_time:
            bundle.eventWindows.find((row) =>
              overlaps(startTime, endTime, row.start_time, row.end_time),
            )?.start_time || '00:00:00',
          end_time:
            bundle.eventWindows.find((row) =>
              overlaps(startTime, endTime, row.start_time, row.end_time),
            )?.end_time || '23:59:59',
        },
      }
    return { clear: true, reason: null, conflict: null, endTime }
  }

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]
    const override = input.visitOverrides?.[candidate.original_date]
    const selectedDate = override ? override.date : candidate.date
    const selectedTime = normalizedTime(
      override ? override.start_time : candidate.start_time,
    )
    const nextDue = [
      candidate.next_original_date,
      candidates[index + 1]?.original_date,
    ]
      .filter((date): date is string => Boolean(date))
      .sort()[0]
    const withinBounds = (date: string) =>
      validDate(date) &&
      date >= candidate.original_date &&
      date <= addDays(candidate.original_date, 14) &&
      (!nextDue || date < nextDue)
    const initial = withinBounds(selectedDate)
      ? check(selectedDate, selectedTime)
      : {
          clear: false,
          reason:
            'Choose a weekday within 14 days of this visit and before its next due date.',
          conflict: null,
          endTime: minutesToTime(
            timeToMinutes(selectedTime) + input.durationMinutes,
          ),
        }
    const available: RecurringScheduleAlternative[] = []
    // Start on the preferred weekday. Weekend normalization never permits crossing the next due date.
    let searchDate =
      candidate.date < candidate.original_date
        ? candidate.original_date
        : candidate.date
    while (withinBounds(searchDate)) {
      const bundle = day(searchDate)
      if (bundle.open && bundle.templates.length) {
        const slots = getAvailableSlots({
          date: searchDate,
          requiredMinutes: input.durationMinutes,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: windows(searchDate),
          minStartMinutes: searchDate === today ? earliestToday : undefined,
          maxResults: 100,
        })
        const preferredTime = normalizedTime(candidate.start_time)
        const preferred = check(searchDate, preferredTime)
        if (
          preferred.clear &&
          !slots.some((slot) => slot.start_time === preferredTime)
        ) {
          slots.push({ start_time: preferredTime, end_time: preferred.endTime })
          slots.sort(
            (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time),
          )
        }
        for (const slot of slots) {
          if (
            searchDate === selectedDate &&
            slot.start_time === selectedTime &&
            initial.clear
          )
            continue
          available.push({ date: searchDate, ...slot })
        }
      }
      searchDate = addDays(searchDate, 1)
    }
    const automatic =
      !override && input.schedulingMode === 'flexible' && !initial.clear
        ? available
            .sort(
              (a, b) =>
                a.date.localeCompare(b.date) ||
                Math.abs(
                  timeToMinutes(a.start_time) -
                    timeToMinutes(candidate.start_time),
                ) -
                  Math.abs(
                    timeToMinutes(b.start_time) -
                      timeToMinutes(candidate.start_time),
                  ) ||
                a.start_time.localeCompare(b.start_time),
            )
            .shift()
        : undefined
    const chosen = automatic || {
      date: selectedDate,
      start_time: selectedTime,
      end_time: initial.endTime,
    }
    const clear = Boolean(automatic) || initial.clear
    const occurrence: RecurringScheduleOccurrence = {
      ...chosen,
      original_date: candidate.original_date,
      status: clear ? 'clear' : 'conflict',
      shifted:
        chosen.date !== candidate.original_date ||
        chosen.start_time !== normalizedTime(candidate.start_time),
      reason: automatic
        ? `${initial.reason || 'The preferred visit is unavailable'} Scheduled in the next available window.`
        : override && !clear
          ? `The selected visit is unavailable. ${initial.reason}`
          : initial.reason,
      alternatives: available,
      conflict: clear ? null : initial.conflict,
    }
    result.occurrences.push(occurrence)
    if (clear)
      reservations.push({
        appointment_date: chosen.date,
        start_time: chosen.start_time,
        end_time: chosen.end_time,
        status: 'booked',
        recurring_template_id: null,
        ops_customers: { business_name: 'Another proposed recurring visit' },
      })
  }
  return result
}
