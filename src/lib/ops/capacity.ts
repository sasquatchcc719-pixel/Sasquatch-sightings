import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Schedule-based capacity for stats/utilization.
 *
 * Available hours come from the same data the booking system uses:
 *  - availability_templates (working windows per weekday, global or per-staff)
 *  - staff_users (is_active, default_open)
 *  - staff_daily_availability (per-day open/closed toggles per tech)
 *
 * A day's capacity is the sum of template hours for every tech available that
 * day. Availability for capacity is NOT the same as booking availability:
 * default-open staff (Charles) toggle themselves closed only so the primary
 * tech's calendar fills first — that's routing, not time off — so they count
 * as available on every templated day regardless of toggles. Default-closed
 * staff (hired techs) count only on their toggled-open days. Days beyond the
 * last recorded toggle are projected at the trailing 4-week average.
 */

export type CapacityTemplate = {
  day_of_week: number
  start_time: string
  end_time: string
  staff_user_id: string | null
}

export type CapacityStaff = {
  id: string
  default_open: boolean
}

export type CapacityToggle = {
  staff_user_id: string
  date: string
  is_open: boolean
}

export type CapacityResult = {
  /** Actual available hours from Jan 1 through today. */
  ytdAvailableHours: number
  /** YTD actual + future (toggles where present, trailing average beyond). */
  annualAvailableHours: number
  /** Trailing 4-week average weekly capacity — "capacity right now". */
  currentWeeklyCapacity: number
  lastToggleDate: string | null
}

function timeToHours(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number)
  return h + (m || 0) / 60
}

function parseUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function toDayString(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function businessToday(timeZone = 'America/Denver'): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

export function computeScheduleCapacity(params: {
  templates: CapacityTemplate[]
  staff: CapacityStaff[]
  toggles: CapacityToggle[]
  today: string
  yearStart?: string
  yearEnd?: string
}): CapacityResult {
  const { templates, staff, toggles, today } = params
  const year = today.slice(0, 4)
  const yearStart = params.yearStart ?? `${year}-01-01`
  const yearEnd = params.yearEnd ?? `${year}-12-31`

  // Template hours per weekday: per-staff templates win, else global.
  const globalHours = new Array<number>(7).fill(0)
  const staffHours = new Map<string, number[]>()
  for (const t of templates) {
    const hrs = Math.max(0, timeToHours(t.end_time) - timeToHours(t.start_time))
    if (t.staff_user_id) {
      const arr =
        staffHours.get(t.staff_user_id) ?? new Array<number>(7).fill(0)
      arr[t.day_of_week] += hrs
      staffHours.set(t.staff_user_id, arr)
    } else {
      globalHours[t.day_of_week] += hrs
    }
  }

  const toggleMap = new Map<string, boolean>()
  let lastToggleDate: string | null = null
  for (const tg of toggles) {
    toggleMap.set(`${tg.staff_user_id}|${tg.date}`, tg.is_open)
    if (!lastToggleDate || tg.date > lastToggleDate) lastToggleDate = tg.date
  }

  const dayCapacity = (day: string, dow: number): number => {
    let total = 0
    for (const s of staff) {
      // Default-open staff count every templated day — their closed toggles
      // are booking routing (fill the primary tech first), not time off.
      const available =
        s.default_open || toggleMap.get(`${s.id}|${day}`) === true
      if (!available) continue
      const perStaff = staffHours.get(s.id)
      total += perStaff ? perStaff[dow] : globalHours[dow]
    }
    return total
  }

  // Walk the year once, accumulating actual (YTD), trailing window, and
  // toggle-backed future capacity.
  const trailingStart = toDayString(
    new Date(parseUtcDate(today).getTime() - 27 * 86400000),
  )
  let ytd = 0
  let trailing28 = 0
  let futureWithToggles = 0
  let futureDaysBeyondToggles = 0

  const cursor = parseUtcDate(yearStart)
  const end = parseUtcDate(yearEnd)
  while (cursor.getTime() <= end.getTime()) {
    const day = toDayString(cursor)
    const cap = dayCapacity(day, cursor.getUTCDay())
    if (day <= today) {
      ytd += cap
      if (day >= trailingStart) trailing28 += cap
    } else if (lastToggleDate && day <= lastToggleDate) {
      futureWithToggles += cap
    } else {
      futureDaysBeyondToggles++
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  // Weekly capacity "now": trailing 4 weeks, falling back to the YTD average
  // if the trailing window is empty (e.g. extended time off).
  const daysElapsed =
    Math.round(
      (parseUtcDate(today).getTime() - parseUtcDate(yearStart).getTime()) /
        86400000,
    ) + 1
  const ytdWeeklyAvg = daysElapsed > 0 ? (ytd / daysElapsed) * 7 : 0
  const currentWeeklyCapacity = trailing28 > 0 ? trailing28 / 4 : ytdWeeklyAvg

  const annualAvailableHours =
    ytd +
    futureWithToggles +
    futureDaysBeyondToggles * (currentWeeklyCapacity / 7)

  const round1 = (n: number) => Math.round(n * 10) / 10
  return {
    ytdAvailableHours: round1(ytd),
    annualAvailableHours: round1(annualAvailableHours),
    currentWeeklyCapacity: round1(currentWeeklyCapacity),
    lastToggleDate,
  }
}

/**
 * Load schedule data and compute capacity. Returns null when there is no
 * usable schedule data (caller should fall back to the flat settings model).
 */
export async function loadScheduleCapacity(
  supabase: SupabaseClient,
): Promise<CapacityResult | null> {
  const today = businessToday()
  const yearStart = `${today.slice(0, 4)}-01-01`

  const [templatesRes, staffRes, togglesRes] = await Promise.all([
    supabase
      .from('availability_templates')
      .select('day_of_week, start_time, end_time, staff_user_id')
      .eq('is_active', true),
    supabase
      .from('staff_users')
      .select('id, default_open')
      .eq('is_active', true),
    supabase
      .from('staff_daily_availability')
      .select('staff_user_id, date, is_open')
      .gte('date', yearStart),
  ])

  const templates = (templatesRes.data ?? []) as CapacityTemplate[]
  const staff = (staffRes.data ?? []) as CapacityStaff[]
  if (templates.length === 0 || staff.length === 0) return null

  const result = computeScheduleCapacity({
    templates,
    staff,
    toggles: (togglesRes.data ?? []) as CapacityToggle[],
    today,
  })

  if (result.ytdAvailableHours <= 0) return null
  return result
}
