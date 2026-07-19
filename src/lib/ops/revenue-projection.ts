import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Year-end revenue projection.
 *
 * The old model was `ytdRevenue / weeksElapsed * work_weeks_per_year`, which
 * assumes every week of the year looks like the average week so far. That
 * badly understates a business whose capacity changed mid-year (hiring a
 * second tech in May 2026 roughly doubled monthly revenue), because the slow
 * solo-owner months get averaged into the forecast for the busy months ahead.
 *
 * This model instead:
 *   1. Learns the real seasonal shape from QuickBooks history (prior complete
 *      years), so autumn is not assumed to look like spring.
 *   2. Takes the run rate from a recent window only — current staffing —
 *      and de-seasonalises it into an annualised rate.
 *   3. Projects the remaining months at that rate, weighted by season.
 *   4. Uses already-booked calendar work as a floor, since it is contracted.
 */

export type RevenueProjection = {
  ytdActual: number
  /** Work already on the calendar for the rest of this year. */
  bookedRemainder: number
  /** Forecast for the rest of the year (never below bookedRemainder). */
  projectedRemainder: number
  projectedAnnual: number
  /** 'seasonal' when prior-year history was available, else 'linear'. */
  method: 'seasonal' | 'linear'
  /** Annual revenue implied by the recent window's pace. */
  annualizedRunRate: number
  /** Share of a typical year's revenue that normally lands by today (0–1). */
  elapsedShare: number
  remainingShare: number
  /** Months feeding the run rate, e.g. "May–Jul". */
  recentWindowLabel: string
  recentWindowRevenue: number
  seasonality: number[] | null
  seasonalityYears: number[]
  /** True when the forecast is just the booked floor (rare, low season). */
  bookedIsFloor: boolean
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const round2 = (n: number) => Math.round(n * 100) / 100

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function projectAnnualRevenue(params: {
  /** Completed revenue per month, index 0–11. */
  monthlyCompleted: number[]
  /** Booked-but-not-done revenue per month, index 0–11. */
  monthlyBooked: number[]
  /** Share of annual revenue per month (sums to ~1), or null for no history. */
  seasonality: number[] | null
  seasonalityYears?: number[]
  /** YYYY-MM-DD. */
  today: string
  /** How many months of recent history define "current pace". */
  recentWindowMonths?: number
}): RevenueProjection {
  const {
    monthlyCompleted,
    monthlyBooked,
    seasonality,
    seasonalityYears = [],
    today,
  } = params
  const windowMonths = Math.max(1, params.recentWindowMonths ?? 3)

  const [yearStr, monthStr, dayStr] = today.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const day = Number(dayStr)
  // Fraction of the current month already elapsed (day 16 of 31 ≈ 0.516).
  const monthFraction = Math.min(day / daysInMonth(year, monthIndex), 1)

  const ytdActual = monthlyCompleted.reduce((s, v) => s + (v || 0), 0)

  // Booked work from the current month forward.
  let bookedRemainder = 0
  for (let m = monthIndex; m < 12; m++) bookedRemainder += monthlyBooked[m] || 0

  // Revenue in the recent window (the current partial month + prior months).
  const windowStart = Math.max(0, monthIndex - (windowMonths - 1))
  let recentWindowRevenue = 0
  for (let m = windowStart; m <= monthIndex; m++) {
    recentWindowRevenue += monthlyCompleted[m] || 0
  }
  const recentWindowLabel =
    windowStart === monthIndex
      ? MONTH_ABBR[monthIndex]
      : `${MONTH_ABBR[windowStart]}–${MONTH_ABBR[monthIndex]}`

  const validSeasonality =
    seasonality &&
    seasonality.length === 12 &&
    seasonality.every((v) => Number.isFinite(v) && v >= 0) &&
    seasonality.reduce((s, v) => s + v, 0) > 0.5

  let elapsedShare: number
  let remainingShare: number
  let annualizedRunRate: number
  let method: 'seasonal' | 'linear'

  if (validSeasonality) {
    method = 'seasonal'
    const s = seasonality as number[]
    elapsedShare = 0
    for (let m = 0; m < monthIndex; m++) elapsedShare += s[m]
    elapsedShare += s[monthIndex] * monthFraction
    remainingShare = Math.max(0, 1 - elapsedShare)

    // Seasonal weight of the recent window, so the run rate is comparable
    // across months of differing strength.
    let windowShare = 0
    for (let m = windowStart; m < monthIndex; m++) windowShare += s[m]
    windowShare += s[monthIndex] * monthFraction

    annualizedRunRate =
      windowShare > 0 ? recentWindowRevenue / windowShare : ytdActual
  } else {
    method = 'linear'
    // No history: assume every month is equal.
    const elapsedMonths = monthIndex + monthFraction
    elapsedShare = elapsedMonths / 12
    remainingShare = Math.max(0, 1 - elapsedShare)
    const windowElapsed = monthIndex - windowStart + monthFraction
    annualizedRunRate =
      windowElapsed > 0 ? (recentWindowRevenue / windowElapsed) * 12 : ytdActual
  }

  const forecastRemainder = annualizedRunRate * remainingShare
  const bookedIsFloor = bookedRemainder > forecastRemainder
  const projectedRemainder = Math.max(forecastRemainder, bookedRemainder)

  return {
    ytdActual: round2(ytdActual),
    bookedRemainder: round2(bookedRemainder),
    projectedRemainder: round2(projectedRemainder),
    projectedAnnual: round2(ytdActual + projectedRemainder),
    method,
    annualizedRunRate: round2(annualizedRunRate),
    elapsedShare: round2(elapsedShare),
    remainingShare: round2(remainingShare),
    recentWindowLabel,
    recentWindowRevenue: round2(recentWindowRevenue),
    seasonality: validSeasonality ? seasonality : null,
    seasonalityYears,
    bookedIsFloor,
  }
}

/**
 * Monthly seasonality learned from QuickBooks history. Only complete prior
 * years with enough transactions to be meaningful are used — the earliest
 * years of the business are too sparse to describe a seasonal shape.
 */
export async function loadSeasonality(
  supabase: SupabaseClient,
  options?: { currentYear: number; minTransactions?: number },
): Promise<{ seasonality: number[] | null; years: number[] }> {
  const currentYear = options?.currentYear ?? new Date().getFullYear()
  const minTransactions = options?.minTransactions ?? 50

  const { data, error } = await supabase
    .from('qb_historical_transactions')
    .select('txn_date, total')
    .not('txn_date', 'is', null)
    .lt('txn_date', `${currentYear}-01-01`)
    .limit(20000)

  if (error || !data || data.length === 0) {
    return { seasonality: null, years: [] }
  }

  // Bucket revenue and transaction counts by year and month.
  const byYear = new Map<number, { months: number[]; count: number }>()
  for (const row of data) {
    const date = String(row.txn_date)
    const year = Number(date.slice(0, 4))
    const monthIndex = Number(date.slice(5, 7)) - 1
    if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) continue
    let entry = byYear.get(year)
    if (!entry) {
      entry = { months: new Array(12).fill(0), count: 0 }
      byYear.set(year, entry)
    }
    entry.months[monthIndex] += Number(row.total || 0)
    entry.count++
  }

  const usableYears = [...byYear.entries()]
    .filter(([, v]) => {
      const total = v.months.reduce((s, m) => s + m, 0)
      const activeMonths = v.months.filter((m) => m > 0).length
      return v.count >= minTransactions && total > 0 && activeMonths >= 9
    })
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)

  if (usableYears.length === 0) return { seasonality: null, years: [] }

  // Average each month's share of its own year, so a big year and a small
  // year contribute equally to the seasonal shape.
  const shares = new Array(12).fill(0)
  for (const [, v] of usableYears) {
    const total = v.months.reduce((s, m) => s + m, 0)
    for (let m = 0; m < 12; m++) shares[m] += v.months[m] / total
  }
  const seasonality = shares.map((s) => s / usableYears.length)

  return {
    seasonality,
    years: usableYears.map(([y]) => y).sort(),
  }
}
