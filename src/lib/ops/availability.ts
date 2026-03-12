export type AvailabilityTemplate = {
  day_of_week: number
  start_time: string
  end_time: string
  slot_interval_minutes: number
  is_active: boolean
}

export type AvailabilityOverride = {
  override_date: string
  start_time: string | null
  end_time: string | null
  is_available: boolean
}

export type ExistingAppointmentWindow = {
  appointment_date: string
  start_time: string
  end_time: string
  status: string
}

export type SlotOption = {
  start_time: string
  end_time: string
}

export const DEFAULT_APPOINTMENT_BUFFER_MINUTES = 30

const ACTIVE_APPOINTMENT_STATUSES = new Set([
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
])

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
}

function overlaps(
  startMinutes: number,
  endMinutes: number,
  busyStart: number,
  busyEnd: number,
): boolean {
  return startMinutes < busyEnd && endMinutes > busyStart
}

export function calculateLineItemDurationMinutes(params: {
  durationMinutes: number
  quantity: number
}): number {
  const quantity = Number.isFinite(params.quantity) ? params.quantity : 1
  return Math.max(0, Math.round(params.durationMinutes * quantity))
}

export function applyAppointmentBuffer(
  serviceMinutes: number,
  bufferMinutes: number = DEFAULT_APPOINTMENT_BUFFER_MINUTES,
): number {
  const normalizedServiceMinutes = Number.isFinite(serviceMinutes)
    ? serviceMinutes
    : 0
  const normalizedBuffer = Number.isFinite(bufferMinutes) ? bufferMinutes : 0
  return Math.max(0, Math.round(normalizedServiceMinutes + normalizedBuffer))
}

export function getAvailableSlots(params: {
  date: string
  requiredMinutes: number
  templates: AvailabilityTemplate[]
  overrides: AvailabilityOverride[]
  appointments: ExistingAppointmentWindow[]
  maxResults?: number
}): SlotOption[] {
  const {
    date,
    requiredMinutes,
    templates,
    overrides,
    appointments,
    maxResults = 6,
  } = params

  if (!date || requiredMinutes <= 0) {
    return []
  }

  const dayOfWeek = new Date(`${date}T12:00:00`).getDay()
  const dayTemplates = templates.filter(
    (template) => template.is_active && template.day_of_week === dayOfWeek,
  )

  const dayOverrides = overrides.filter(
    (override) => override.override_date === date,
  )

  const blockedWindows = appointments
    .filter(
      (appointment) =>
        appointment.appointment_date === date &&
        ACTIVE_APPOINTMENT_STATUSES.has(appointment.status),
    )
    .map((appointment) => ({
      start: timeToMinutes(appointment.start_time),
      end: timeToMinutes(appointment.end_time),
    }))

  const slots: SlotOption[] = []

  for (const template of dayTemplates) {
    const windowStart = timeToMinutes(template.start_time)
    const windowEnd = timeToMinutes(template.end_time)

    for (
      let current = windowStart;
      current + requiredMinutes <= windowEnd;
      current += template.slot_interval_minutes
    ) {
      const slotEnd = current + requiredMinutes

      const blockedByOverride = dayOverrides.some((override) => {
        if (!override.is_available) {
          if (!override.start_time || !override.end_time) {
            return true
          }

          return overlaps(
            current,
            slotEnd,
            timeToMinutes(override.start_time),
            timeToMinutes(override.end_time),
          )
        }

        return false
      })

      if (blockedByOverride) {
        continue
      }

      const clashesWithAppointment = blockedWindows.some((busy) =>
        overlaps(current, slotEnd, busy.start, busy.end),
      )

      if (clashesWithAppointment) {
        continue
      }

      slots.push({
        start_time: minutesToTime(current),
        end_time: minutesToTime(slotEnd),
      })

      if (slots.length >= maxResults) {
        return slots
      }
    }
  }

  return slots
}
