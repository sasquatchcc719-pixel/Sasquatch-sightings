import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Year-over-year history from QuickBooks invoices (2021→present, imported
 * into qb_historical_transactions).
 *
 * The headline comparison is same-period-to-date, not full years: comparing
 * a partial current year against completed prior years would always look
 * like a collapse. "Through July 19" vs "through July 19" is the honest read.
 *
 * Caveat carried in the type: this is QuickBooks *invoices*. Jobs recorded
 * as sales receipts (immediate cash/card) are not included.
 */

export type YearSummary = {
  year: number
  /** Every invoice dated in that year. Partial for the current year. */
  fullYear: number
  /** Invoices dated on or before today's month/day in that year. */
  throughToday: number
  invoices: number
  invoicesThroughToday: number
  /**
   * Mean invoice value. Misleading on its own: a handful of large commercial
   * invoices (e.g. Recovery Village) dominate it, so the mean FALLS as the
   * regular customer base grows even when typical jobs get more valuable.
   */
  avgTicket: number
  /** Median invoice value — what a typical job is actually worth. */
  medianTicket: number
  /** Growth of throughToday vs the prior year's throughToday, in percent. */
  ytdGrowthPct: number | null
  isCurrentYear: boolean
  isPartialHistory: boolean
}

export type YearOverYear = {
  years: YearSummary[]
  currentYear: number
  /** Current year revenue to date. */
  ytd: number
  /** Prior year revenue at this same point in the calendar. */
  priorYtd: number
  ytdGrowthPct: number | null
  /** Prior year's completed total — the bar this year is chasing. */
  priorFullYear: number
  /** Current YTD as a percent of last year's entire total. */
  pctOfPriorFullYear: number | null
  asOfLabel: string
  /**
   * The newest transaction actually present, and how many days of the
   * requested window are therefore missing.
   *
   * qb_historical_transactions is a one-time import that nothing refreshes.
   * It stopped on 2026-07-14 and the card went on claiming "through September
   * 1" for seven weeks, hiding roughly $64,000 of completed work. Charles:
   * "I would've just assumed that it needed to be re-updated." He had no way
   * to know — so the card now says how old the data is.
   */
  dataThroughLabel: string | null
  staleDays: number
}

const round0 = (n: number) => Math.round(n)

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}
const round1 = (n: number) => Math.round(n * 10) / 10

/** Years below this invoice count are too sparse to chart meaningfully. */
const MIN_INVOICES = 20

export function summarizeYearOverYear(
  rows: { txn_date: string; total: number | string | null }[],
  today: string,
): YearOverYear {
  const currentYear = Number(today.slice(0, 4))
  const todayMonth = Number(today.slice(5, 7))
  const todayDay = Number(today.slice(8, 10))

  type Acc = {
    fullYear: number
    throughToday: number
    invoices: number
    invoicesThroughToday: number
    amounts: number[]
  }
  const byYear = new Map<number, Acc>()

  for (const row of rows) {
    const date = String(row.txn_date || '')
    if (date.length < 10) continue
    const year = Number(date.slice(0, 4))
    const month = Number(date.slice(5, 7))
    const day = Number(date.slice(8, 10))
    const amount = Number(row.total || 0)

    let acc = byYear.get(year)
    if (!acc) {
      acc = {
        fullYear: 0,
        throughToday: 0,
        invoices: 0,
        invoicesThroughToday: 0,
        amounts: [],
      }
      byYear.set(year, acc)
    }
    acc.fullYear += amount
    acc.invoices++
    acc.amounts.push(amount)
    // Same calendar point: on or before today's month/day.
    if (month < todayMonth || (month === todayMonth && day <= todayDay)) {
      acc.throughToday += amount
      acc.invoicesThroughToday++
    }
  }

  const sorted = [...byYear.entries()]
    .filter(([, v]) => v.invoices >= MIN_INVOICES)
    .sort((a, b) => a[0] - b[0])

  const years: YearSummary[] = sorted.map(([year, v], index) => {
    const prior = index > 0 ? sorted[index - 1][1] : null
    const ytdGrowthPct =
      prior && prior.throughToday > 0
        ? round1((v.throughToday / prior.throughToday - 1) * 100)
        : null
    return {
      year,
      fullYear: round0(v.fullYear),
      throughToday: round0(v.throughToday),
      invoices: v.invoices,
      invoicesThroughToday: v.invoicesThroughToday,
      avgTicket: v.invoices > 0 ? round0(v.fullYear / v.invoices) : 0,
      medianTicket: round0(median(v.amounts)),
      ytdGrowthPct,
      isCurrentYear: year === currentYear,
      // Flagged when the year's data starts late (e.g. QuickBooks adopted
      // mid-year), so a low total isn't mistaken for a bad year.
      isPartialHistory: false,
    }
  })

  const current = years.find((y) => y.isCurrentYear)
  const priorEntry = years.filter((y) => y.year < currentYear).slice(-1)[0]

  const ytd = current?.throughToday ?? 0
  const priorYtd = priorEntry?.throughToday ?? 0
  const priorFullYear = priorEntry?.fullYear ?? 0

  const newestTxn = rows.reduce<string>(
    (max, r) => (r.txn_date && r.txn_date > max ? r.txn_date : max),
    '',
  )
  const dataThroughLabel = newestTxn
    ? new Date(`${newestTxn}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null
  const staleDays = newestTxn
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${today}T12:00:00Z`) -
            Date.parse(`${newestTxn}T12:00:00Z`)) /
            86_400_000,
        ),
      )
    : 0

  const asOfLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return {
    years,
    currentYear,
    ytd,
    priorYtd,
    ytdGrowthPct: priorYtd > 0 ? round1((ytd / priorYtd - 1) * 100) : null,
    priorFullYear,
    pctOfPriorFullYear:
      priorFullYear > 0 ? round1((ytd / priorFullYear) * 100) : null,
    asOfLabel,
    dataThroughLabel,
    staleDays,
  }
}

export async function loadYearOverYear(
  supabase: SupabaseClient,
  options?: { today?: string },
): Promise<YearOverYear | null> {
  const today =
    options?.today ??
    new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Denver',
    })

  const { data, error } = await supabase
    .from('qb_historical_transactions')
    .select('txn_date, total')
    .not('txn_date', 'is', null)
    .limit(20000)

  if (error || !data || data.length === 0) return null

  const result = summarizeYearOverYear(
    data as { txn_date: string; total: number | string | null }[],
    today,
  )
  return result.years.length > 0 ? result : null
}
