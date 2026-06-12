import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACTIVE_APPOINTMENT_STATUSES,
  calendarEventsToAppointmentWindows,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  timeToMinutes,
  type AvailabilityTemplate,
  type AvailabilityOverride,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'

export type AvailabilityBundle = {
  templates: AvailabilityTemplate[]
  overrides: AvailabilityOverride[]
  appointments: ExistingAppointmentWindow[]
}

/**
 * Returns the first active appointment or blocking calendar event that
 * overlaps the proposed window on `date`, or null when the window is clear.
 * When `staffUserId` is given, only that tech's calendar is checked (plus
 * staff-agnostic calendar events); otherwise every appointment counts.
 */
export async function findAppointmentConflict(
  supabase: SupabaseClient,
  params: {
    date: string
    startTime: string
    endTime: string
    excludeAppointmentId?: string
    staffUserId?: string
  },
): Promise<ExistingAppointmentWindow | null> {
  const bundle = await loadAvailabilityBundle(supabase, params.date, {
    excludeAppointmentId: params.excludeAppointmentId,
    staffUserId: params.staffUserId,
  })
  const proposedStart = timeToMinutes(params.startTime)
  const proposedEnd = timeToMinutes(params.endTime)
  if (!(proposedEnd > proposedStart)) return null

  for (const window of bundle.appointments) {
    if (window.appointment_date !== params.date) continue
    if (
      window.status !== 'booked' &&
      !ACTIVE_APPOINTMENT_STATUSES.has(window.status)
    ) {
      continue
    }
    const existingStart = timeToMinutes(window.start_time)
    const existingEnd = timeToMinutes(window.end_time)
    if (proposedStart < existingEnd && existingStart < proposedEnd) {
      return window
    }
  }
  return null
}

export async function loadAvailabilityBundle(
  supabase: SupabaseClient,
  date: string,
  options?: {
    excludeAppointmentId?: string
    staffUserId?: string
  },
): Promise<AvailabilityBundle> {
  const { excludeAppointmentId, staffUserId } = options || {}

  let templatesQuery = supabase
    .from('availability_templates')
    .select('*')
    .eq('is_active', true)

  let overridesQuery = supabase
    .from('availability_overrides')
    .select('*')
    .eq('override_date', date)

  let appointmentsQuery = supabase
    .from('ops_appointments')
    .select(
      'id, appointment_date, start_time, end_time, status, assigned_staff_user_id',
    )
    .eq('appointment_date', date)

  let eventsQuery = supabase
    .from('ops_calendar_events')
    .select(
      'event_kind, start_date, end_date, start_time, end_time, is_all_day, assigned_staff_user_id',
    )
    .lte('start_date', date)
    .gte('end_date', date)

  if (staffUserId) {
    templatesQuery = templatesQuery.or(
      `staff_user_id.eq.${staffUserId},staff_user_id.is.null`,
    )
    overridesQuery = overridesQuery.or(
      `staff_user_id.eq.${staffUserId},staff_user_id.is.null`,
    )
    appointmentsQuery = appointmentsQuery.eq(
      'assigned_staff_user_id',
      staffUserId,
    )
    eventsQuery = eventsQuery.or(
      `assigned_staff_user_id.eq.${staffUserId},assigned_staff_user_id.is.null`,
    )
  }

  const [templatesResult, overridesResult, appointmentsResult, eventsResult] =
    await Promise.all([
      templatesQuery,
      overridesQuery,
      appointmentsQuery,
      eventsQuery,
    ])

  let templates = (templatesResult.data || []) as AvailabilityTemplate[]

  if (staffUserId && templates.length > 0) {
    const staffSpecific = templates.filter(
      (t: AvailabilityTemplate & { staff_user_id?: string | null }) =>
        t.staff_user_id === staffUserId,
    )
    if (staffSpecific.length > 0) {
      templates = staffSpecific
    }
  }

  if (templates.length === 0) {
    console.warn(
      '⚠️  No active availability_templates found — auto-seeding defaults',
    )
    const defaults = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES.map((t) => ({
      day_of_week: t.day_of_week,
      start_time: t.start_time,
      end_time: t.end_time,
      slot_interval_minutes: t.slot_interval_minutes,
      is_active: true,
    }))
    const { data: seeded } = await supabase
      .from('availability_templates')
      .upsert(defaults, { onConflict: 'day_of_week' })
      .select('*')
    if (seeded && seeded.length > 0)
      templates = seeded as AvailabilityTemplate[]
    else templates = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES
  }

  let rows = (appointmentsResult.data || []) as Array<
    ExistingAppointmentWindow & { id: string }
  >
  if (excludeAppointmentId) {
    rows = rows.filter((a) => a.id !== excludeAppointmentId)
  }

  return {
    templates,
    overrides: (overridesResult.data || []) as AvailabilityOverride[],
    appointments: [
      ...rows.map(({ appointment_date, start_time, end_time, status }) => ({
        appointment_date,
        start_time,
        end_time,
        status,
      })),
      ...calendarEventsToAppointmentWindows(date, eventsResult.data || []),
    ],
  }
}
