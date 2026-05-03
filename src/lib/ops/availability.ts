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

export const DEFAULT_APPOINTMENT_BUFFER_MINUTES = 0

/**
 * Fixed 2-hour arrival-window block boundaries (minutes since midnight).
 * 09:00, 11:00, 13:00, 15:00
 */
export const BLOCK_STARTS_MINUTES = [540, 660, 780, 900] as const
export const BLOCK_DURATION_MINUTES = 120

/**
 * Hard ceiling on any single appointment's scheduled window.
 * No job should ever block more than 4 hours of calendar time regardless
 * of how many services or how the duration math works out.
 */
export const MAX_APPOINTMENT_MINUTES = 240 // 4 hours

export const DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES: AvailabilityTemplate[] = [
  {
    day_of_week: 1,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
  {
    day_of_week: 2,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
  {
    day_of_week: 3,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
  {
    day_of_week: 4,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
  {
    day_of_week: 5,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
  {
    day_of_week: 6,
    start_time: '09:00',
    end_time: '17:00',
    slot_interval_minutes: 120,
    is_active: true,
  },
]

const ACTIVE_APPOINTMENT_STATUSES = new Set([
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
  'completed',
])

export function timeToMinutes(value: string): number {
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

/**
 * Calculate appointment duration based on total dollar amount.
 * Simple tier-based system:
 *   $0-$300     → 2 hours (120 min)
 *   $301-$600   → 3 hours (180 min)
 *   $601+       → 4 hours (240 min)
 */
export function calculateAppointmentDurationFromTotal(
  totalDollars: number,
): number {
  const total = Number.isFinite(totalDollars) ? totalDollars : 0
  // Force redeploy - dollar-based tiers
  if (total <= 300) return 120
  if (total <= 600) return 180
  return 240
}

/**
 * @deprecated Use calculateAppointmentDurationFromTotal instead.
 * This function is kept for backwards compatibility but should not be used
 * for new code. Duration is now calculated from total dollar amount.
 */
export function calculateLineItemDurationMinutes(params: {
  durationMinutes: number
  quantity: number
  pricingUnit?: string | null
  unitPrice?: number | null
  catalogSlug?: string | null
  nameSnapshot?: string | null
  applyOversizedResidentialDollarDuration?: boolean
}): number {
  // For backwards compatibility, return base duration without quantity scaling
  const raw = Number.isFinite(params.durationMinutes)
    ? params.durationMinutes
    : 60
  return Math.max(0, Math.round(raw))
}

export function applyAppointmentBuffer(
  serviceMinutes: number,
  bufferMinutes: number = DEFAULT_APPOINTMENT_BUFFER_MINUTES,
): number {
  const normalizedServiceMinutes = Number.isFinite(serviceMinutes)
    ? serviceMinutes
    : 0
  const normalizedBuffer = Number.isFinite(bufferMinutes) ? bufferMinutes : 0
  // Cap at hard maximum BEFORE rounding up to block boundaries so the ceiling
  // is never exceeded due to rounding.
  const capped = Math.min(
    Math.max(0, normalizedServiceMinutes + normalizedBuffer),
    MAX_APPOINTMENT_MINUTES,
  )
  return Math.ceil(capped / 30) * 30
}

export function getAvailableSlots(params: {
  date: string
  requiredMinutes: number
  templates: AvailabilityTemplate[]
  overrides: AvailabilityOverride[]
  appointments: ExistingAppointmentWindow[]
  minStartMinutes?: number
  maxResults?: number
}): SlotOption[] {
  const {
    date,
    requiredMinutes,
    templates,
    overrides,
    appointments,
    minStartMinutes,
    maxResults = 6,
  } = params

  if (!date || requiredMinutes <= 0) {
    return []
  }

  const effectiveTemplates =
    templates.length > 0 ? templates : DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay()
  let dayTemplates = effectiveTemplates.filter(
    (template) => template.is_active && template.day_of_week === dayOfWeek,
  )
  // If admin saved partial/broken templates (rows exist but none for this weekday),
  // fall back to default hours so public booking still returns slots.
  if (dayTemplates.length === 0 && templates.length > 0) {
    dayTemplates = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES.filter(
      (template) => template.is_active && template.day_of_week === dayOfWeek,
    )
  }

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
  const seen = new Set<number>()

  function trySlot(
    blockStart: number,
    windowStart: number,
    windowEnd: number,
  ): boolean {
    if (minStartMinutes !== undefined && blockStart < minStartMinutes) {
      return false
    }
    if (blockStart < windowStart) return false
    if (blockStart + requiredMinutes > windowEnd) return false
    if (seen.has(blockStart)) return false
    seen.add(blockStart)

    const slotEnd = blockStart + requiredMinutes

    const blockedByOverride = dayOverrides.some((override) => {
      if (!override.is_available) {
        if (!override.start_time || !override.end_time) {
          return true
        }

        return overlaps(
          blockStart,
          slotEnd,
          timeToMinutes(override.start_time),
          timeToMinutes(override.end_time),
        )
      }

      return false
    })

    if (blockedByOverride) return false

    const clashesWithAppointment = blockedWindows.some((busy) =>
      overlaps(blockStart, slotEnd, busy.start, busy.end),
    )

    if (clashesWithAppointment) return false

    slots.push({
      start_time: minutesToTime(blockStart),
      end_time: minutesToTime(slotEnd),
    })

    return true
  }

  for (const template of dayTemplates) {
    const windowStart = timeToMinutes(template.start_time)
    const windowEnd = timeToMinutes(template.end_time)

    // Fixed 2-hour grid starts
    for (const blockStart of BLOCK_STARTS_MINUTES) {
      trySlot(blockStart, windowStart, windowEnd)
    }

    // Gap-fill: offer starts right after each appointment ends, rounded
    // up to the nearest 30-minute mark so the calendar stays tidy.
    for (const busy of blockedWindows) {
      const gapStart = Math.ceil(busy.end / 30) * 30
      if (gapStart >= windowEnd) continue
      if ((BLOCK_STARTS_MINUTES as readonly number[]).includes(gapStart))
        continue
      trySlot(gapStart, windowStart, windowEnd)
    }
  }

  slots.sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time),
  )
  return slots.slice(0, maxResults)
}
