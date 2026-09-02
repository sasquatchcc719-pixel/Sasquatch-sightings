import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The day the ops schedule became the source of truth for revenue.
 *
 * qb_historical_transactions is a one-time import that stopped on 2026-07-14,
 * so the current year was frozen seven weeks behind and understated by about
 * $64,000. Re-importing would only restart the same clock.
 *
 * Instead the timeline is split. Before this date, history lives only in
 * QuickBooks — the ops system has nothing at all before mid-April 2026, and
 * April itself is partial (ops $10,754 against QuickBooks $15,297). That
 * history is finished and will never change, so a frozen archive is the right
 * shape for it. From this date on, the numbers come from the live schedule and
 * cannot go stale.
 *
 * May was chosen as the first month the two sources agree: ops $27,382 against
 * QuickBooks $27,117, inside 1%.
 */
export const OPS_REVENUE_CUTOVER = '2026-05-01'

/** A row from either side of the cutover, reduced to what the summary needs. */
type RevenueRow = { txn_date: string; total: number | string | null }

/**
 * Drop re-imported duplicates and voided invoices from the archive.
 *
 * The import ran more than once without a unique key, so 14 invoices appear
 * two or three times — doc 18151 is in there three times — adding $5,011 of
 * revenue that was never earned. A further 23 rows are $0, which are voided
 * invoices in QuickBooks: they add nothing but inflate the job count and drag
 * the median down ($351 with them, $366 without).
 */
export function cleanArchiveRows(
  rows: Array<RevenueRow & { doc_number?: string | null }>,
): RevenueRow[] {
  const seen = new Set<string>()
  const out: RevenueRow[] = []
  for (const row of rows) {
    if (!row.txn_date) continue
    if (Number(row.total ?? 0) === 0) continue
    const key = `${row.doc_number ?? ''}|${row.txn_date}|${Number(row.total ?? 0)}`
    if (row.doc_number && seen.has(key)) continue
    if (row.doc_number) seen.add(key)
    out.push({ txn_date: row.txn_date, total: row.total })
  }
  return out
}

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
  /**
   * Median over the same through-today window as the dollars beside it.
   *
   * The bar rows used to pair a through-September-1 dollar figure with a
   * full-year job count and a full-year median — two windows on one line, so
   * 2025 read "$77,271" next to "263 jobs" that had actually produced
   * $128,424.
   */
  medianTicketThroughToday: number
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
    amountsThroughToday: number[]
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
        amountsThroughToday: [] as number[],
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
      acc.amountsThroughToday.push(amount)
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
      medianTicketThroughToday: round0(
        median(
          v.amountsThroughToday.length > 0 ? v.amountsThroughToday : v.amounts,
        ),
      ),
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

  // Everything before the cutover: the QuickBooks archive, deduplicated and
  // with voided invoices dropped.
  const { data: archive, error } = await supabase
    .from('qb_historical_transactions')
    .select('txn_date, total, doc_number')
    .not('txn_date', 'is', null)
    .lt('txn_date', OPS_REVENUE_CUTOVER)
    .limit(20000)

  if (error) return null

  // Everything since: the live schedule, valued the same way the rest of
  // reporting values a job — the invoice when there is one, the quoted total
  // otherwise, which is how batch-monthly work like Recovery Village carries
  // its value before its monthly invoice is raised.
  const { data: opsRows } = await supabase
    .from('ops_appointments')
    .select('appointment_date, quoted_total, ops_invoices ( total )')
    .eq('status', 'completed')
    .gte('appointment_date', OPS_REVENUE_CUTOVER)
    .limit(20000)

  const live: RevenueRow[] = (opsRows ?? []).flatMap((row) => {
    const inv = Array.isArray(row.ops_invoices)
      ? row.ops_invoices[0]
      : row.ops_invoices
    const total =
      Number((inv as { total?: number | string | null } | null)?.total ?? 0) ||
      Number(row.quoted_total ?? 0)
    if (!row.appointment_date || total === 0) return []
    return [{ txn_date: String(row.appointment_date), total }]
  })

  const rows = [...cleanArchiveRows(archive ?? []), ...live]
  if (rows.length === 0) return null

  const result = summarizeYearOverYear(rows, today)
  return result.years.length > 0 ? result : null
}
