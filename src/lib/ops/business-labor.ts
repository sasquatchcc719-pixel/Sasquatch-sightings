import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAddOnBonuses } from './add-on-bonuses'

export type RecordedLaborRow = {
  date: string
  paidHours: number
  grossWages: number
  extraPay: number
  entries: number
  issues: string[]
}

export async function loadRecordedBusinessLabor(
  db: SupabaseClient,
  start: string,
  end: string,
): Promise<RecordedLaborRow[]> {
  const [timesheets, premiums, bonuses] = await Promise.all([
    db
      .from('ops_timesheet_entries')
      .select(
        'id,work_date,started_at,ended_at,payable_minutes,gross_pay,clock_state,staff_users(display_name)',
      )
      .gte('work_date', start)
      .lte('work_date', end),
    db
      .from('ops_after_hours_premiums')
      .select('work_date,premium_pay')
      .gte('work_date', start)
      .lte('work_date', end)
      .in('status', ['approved', 'paid']),
    loadAddOnBonuses(db, { startDate: start, endDate: end }),
  ])
  if (timesheets.error) throw timesheets.error
  if (premiums.error) throw premiums.error
  const rows = new Map<string, RecordedLaborRow>()
  function day(date: string) {
    let row = rows.get(date)
    if (!row) {
      row = {
        date,
        paidHours: 0,
        grossWages: 0,
        extraPay: 0,
        entries: 0,
        issues: [],
      }
      rows.set(date, row)
    }
    return row
  }
  for (const entry of timesheets.data || []) {
    const row = day(entry.work_date)
    const staff = Array.isArray(entry.staff_users)
      ? entry.staff_users[0]
      : entry.staff_users
    const name = staff?.display_name || 'Worker'
    if (entry.clock_state !== 'complete') {
      row.issues.push(
        `${entry.work_date}: ${name} has an unfinished shift; wages are incomplete.`,
      )
      continue
    }
    const minutes = Number(entry.payable_minutes || 0)
    const elapsed =
      (new Date(entry.ended_at).getTime() -
        new Date(entry.started_at).getTime()) /
      3600000
    if (
      minutes < 0 ||
      !Number.isFinite(minutes) ||
      !Number.isFinite(Number(entry.gross_pay))
    ) {
      row.issues.push(`${entry.work_date}: ${name} has invalid payroll values.`)
      continue
    }
    row.entries++
    row.paidHours += minutes / 60
    row.grossWages += Number(entry.gross_pay || 0)
    if (minutes > 16 * 60 || elapsed > 16) {
      row.issues.push(
        `${entry.work_date}: ${name}'s recorded shift exceeds 16 hours; review the clock-out time.`,
      )
    }
  }
  for (const premium of premiums.data || [])
    day(premium.work_date).extraPay += Number(premium.premium_pay || 0)
  for (const bonus of bonuses.rows) {
    if (bonus.status === 'earned')
      day(bonus.appointmentDate).extraPay += bonus.bonusAmount
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export type BusinessLaborSummary = {
  recordedLabor: number
  recordedPaidHours: number
  bookedWages: number
  retainedBookWages: number
  otherBookCosts: number
  trackedCost: number
  trackedCostPerHour: number
  trackedCostPct: number
  trackedMarginPct: number
  usesRecordedPayroll: boolean
  laborIssues: string[]
}

export function bookedWageAmount(breakdown: Record<string, number>): number {
  return Object.entries(breakdown)
    .filter(([label]) =>
      /(^| \/ )(wages|salaries|salaries & wages)$/i.test(label),
    )
    .reduce((sum, [, amount]) => sum + amount, 0)
}

export function businessLaborSummary(
  params: {
    windowStart: string
    windowEnd: string
    revenue: number
    productiveHours: number
    quickbooksCost: number
    expenseBreakdown: Record<string, number>
    retainedBookWages?: number
  },
  laborRows: RecordedLaborRow[],
): BusinessLaborSummary {
  const rows = laborRows.filter(
    (r) => r.date >= params.windowStart && r.date <= params.windowEnd,
  )
  const gross = rows.reduce((sum, r) => sum + r.grossWages, 0)
  const extras = rows.reduce((sum, r) => sum + r.extraPay, 0)
  const entries = rows.reduce((sum, r) => sum + r.entries, 0)
  const bookedWages = bookedWageAmount(params.expenseBreakdown)
  const retained = entries > 0 ? params.retainedBookWages || 0 : bookedWages
  // Wage payments are replaced by wages earned in the work window, never added
  // twice. Payroll recruiting, taxes, insurance, and contract labor stay in QB.
  const otherBookCosts = params.quickbooksCost - bookedWages
  const trackedCost = otherBookCosts + retained + gross + extras
  const pct = params.revenue > 0 ? (trackedCost / params.revenue) * 100 : 0
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  return {
    recordedLabor: round(gross + extras),
    recordedPaidHours: round(rows.reduce((sum, r) => sum + r.paidHours, 0)),
    bookedWages: round(bookedWages),
    retainedBookWages: round(retained),
    otherBookCosts: round(otherBookCosts),
    trackedCost: round(trackedCost),
    trackedCostPerHour:
      params.productiveHours > 0
        ? round(trackedCost / params.productiveHours)
        : 0,
    trackedCostPct: round(pct),
    trackedMarginPct: round(100 - pct),
    usesRecordedPayroll: entries > 0,
    laborIssues: rows.flatMap((r) => r.issues),
  }
}
