const GRID_START_HOUR = 7
const GRID_END_HOUR = 20

export const TECH_DAY_HOURS = Array.from(
  { length: GRID_END_HOUR - GRID_START_HOUR },
  (_, index) => GRID_START_HOUR + index,
)
export const TECH_DAY_HOUR_HEIGHT = 84
export const TECH_DAY_GRID_HEIGHT = TECH_DAY_HOURS.length * TECH_DAY_HOUR_HEIGHT

function parseMinutes(value: string | null): number | null {
  if (!value) return null
  const [hour, minute] = value.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

export function getMountainDateKey(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function getTechAppointmentPlacement(
  startTime: string | null,
  endTime: string | null,
): { top: number; height: number } | null {
  const start = parseMinutes(startTime)
  if (start == null) return null

  const gridStart = GRID_START_HOUR * 60
  const gridEnd = GRID_END_HOUR * 60
  const visibleStart = Math.max(start, gridStart)
  const parsedEnd = parseMinutes(endTime)
  const visibleEnd = Math.min(
    Math.max(parsedEnd ?? start + 60, visibleStart + 15),
    gridEnd,
  )

  if (visibleStart >= gridEnd || visibleEnd <= gridStart) return null

  return {
    top: ((visibleStart - gridStart) / 60) * TECH_DAY_HOUR_HEIGHT,
    height: Math.max(
      ((visibleEnd - visibleStart) / 60) * TECH_DAY_HOUR_HEIGHT,
      56,
    ),
  }
}
