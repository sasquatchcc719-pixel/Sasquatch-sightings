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

/** Residential800+ sqft carpet tier in service_catalog_items (per_sqft @ $0.25). */
export const OVERSIZED_RESIDENTIAL_CARPET_SLUG =
  'oversized-room-carpet-cleaning-800-plus-sqft'

const OVERSIZED_RESIDENTIAL_CARPET_NAME =
  'Oversized Room Carpet Cleaning (800+ sqft)'

/** Billable dollars on this line that map to one hour of scheduled time. */
const OVERSIZED_RESIDENTIAL_MINUTES_PER_DOLLAR_BLOCK = 250

function isOversizedResidentialCarpetLine(params: {
  catalogSlug?: string | null
  nameSnapshot?: string | null
}): boolean {
  const slug = params.catalogSlug?.trim()
  if (slug === OVERSIZED_RESIDENTIAL_CARPET_SLUG) return true
  const n = (params.nameSnapshot || '').trim()
  return n === OVERSIZED_RESIDENTIAL_CARPET_NAME
}

/**
 * Calculate how many minutes a line item contributes to the appointment window.
 *
 * For FIXED-price services (rooms, stairs, etc.) duration scales with quantity:
 *   3 rooms × 60 min = 180 min
 *
 * For MEASUREMENT-based services (per_linear_foot, per_sqft, per_unit) the
 * quantity is a dimension, not a count of service instances. Duration is flat:
 *   15.5 linear feet of sectional = 120 min (not 15.5 × 120 = 1,860 min)
 *
 * **Exception — oversized residential carpet (800+ sqft, $0.25/sqft):**
 *   Scheduled time = 1 hour per $250 of line total (quantity × unit_price),
 *   e.g. 1,000 sqft × $0.25 = $250 → 60 min; $500 → 120 min.
 *   Pass unitPrice, and catalogSlug or nameSnapshot so this branch can run.
 *   Set applyOversizedResidentialDollarDuration: false for estimate *measuring*
 *   visits so line-item sqft does not blow up the measure slot.
 *
 * Pass pricingUnit from service_catalog_items.pricing_unit. Anything other
 * than 'fixed' is treated as a measurement and does NOT scale with quantity
 * (except the oversized carpet rule above).
 */
export function calculateLineItemDurationMinutes(params: {
  durationMinutes: number
  quantity: number
  pricingUnit?: string | null
  unitPrice?: number | null
  catalogSlug?: string | null
  nameSnapshot?: string | null
  /** When false, skip the oversized $250/hour rule (e.g. estimate measuring visits). Default true. */
  applyOversizedResidentialDollarDuration?: boolean
}): number {
  const qty = Number.isFinite(params.quantity) ? params.quantity : 1
  const applyOversized =
    params.applyOversizedResidentialDollarDuration !== false
  const unit =
    params.unitPrice != null && Number.isFinite(Number(params.unitPrice))
      ? Number(params.unitPrice)
      : NaN

  if (
    applyOversized &&
    isOversizedResidentialCarpetLine({
      catalogSlug: params.catalogSlug,
      nameSnapshot: params.nameSnapshot,
    }) &&
    Number.isFinite(unit)
  ) {
    const lineTotal = unit * qty
    return Math.max(
      0,
      Math.round(
        (lineTotal / OVERSIZED_RESIDENTIAL_MINUTES_PER_DOLLAR_BLOCK) * 60,
      ),
    )
  }

  const raw = Number.isFinite(params.durationMinutes)
    ? params.durationMinutes
    : 0
  // Only multiply when pricing is truly per-unit (fixed price per room/step/piece)
  const scalesWithQty = !params.pricingUnit || params.pricingUnit === 'fixed'
  return Math.max(0, Math.round(scalesWithQty ? raw * qty : raw))
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
  return Math.ceil(capped / BLOCK_DURATION_MINUTES) * BLOCK_DURATION_MINUTES
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

  for (const template of dayTemplates) {
    const windowStart = timeToMinutes(template.start_time)
    const windowEnd = timeToMinutes(template.end_time)

    for (const blockStart of BLOCK_STARTS_MINUTES) {
      if (blockStart < windowStart) continue
      if (blockStart + requiredMinutes > windowEnd) continue
      if (seen.has(blockStart)) continue
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

      if (blockedByOverride) {
        continue
      }

      const clashesWithAppointment = blockedWindows.some((busy) =>
        overlaps(blockStart, slotEnd, busy.start, busy.end),
      )

      if (clashesWithAppointment) {
        continue
      }

      slots.push({
        start_time: minutesToTime(blockStart),
        end_time: minutesToTime(slotEnd),
      })

      if (slots.length >= maxResults) {
        return slots
      }
    }
  }

  return slots
}
