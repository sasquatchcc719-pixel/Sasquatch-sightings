import type { SupabaseClient } from '@supabase/supabase-js'
import {
  effectiveInvoiceAmount,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'

/**
 * Per-tech profitability: what a tech generates (completed-job revenue and
 * on-the-job hours) against what they cost (timesheet paid hours and gross
 * wages). Wages are gross only — employer taxes and workers comp are not in
 * the DB and are NOT estimated here.
 */

export type TechMonthRow = {
  month: string // YYYY-MM
  jobs: number
  revenue: number
  jobHours: number
  paidHours: number
  grossWages: number
  /** revenue / paidHours (falls back to jobHours when no timesheets) */
  revenuePerPaidHour: number
  /** grossWages / revenue, as percent 0–100 */
  laborPercent: number
  /** jobHours / paidHours, as percent 0–100 */
  billableEfficiency: number
  /** revenue - grossWages */
  profitAfterWages: number
}

export type TechDayRow = Omit<TechMonthRow, 'month'> & {
  date: string // YYYY-MM-DD
  /** (revenue - grossWages) / paidHours (falls back to jobHours) */
  profitPerHour: number
  isLive: boolean
}

export type TechPerformance = {
  staffUserId: string
  displayName: string
  days: TechDayRow[]
  months: TechMonthRow[]
  totals: Omit<TechMonthRow, 'month'>
}

type ApptInput = {
  appointment_date: string
  revenue: number
  hours: number
}

type TimesheetInput = {
  work_date: string
  payable_minutes: number
  gross_pay: number
  isLive?: boolean
}

type StoredTimesheetInput = TimesheetInput & {
  started_at?: string | null
  break_minutes?: number | null
  hourly_rate?: number | null
  clock_state?: string | null
  break_started_at?: string | null
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

export function timesheetInputAt(
  timesheet: StoredTimesheetInput,
  now: Date,
): TimesheetInput {
  const isLive = ['active', 'on_break'].includes(timesheet.clock_state || '')
  if (!isLive || !timesheet.started_at) {
    return {
      work_date: timesheet.work_date,
      payable_minutes: Number(timesheet.payable_minutes || 0),
      gross_pay: Number(timesheet.gross_pay || 0),
    }
  }

  const elapsedMinutes = Math.max(
    0,
    Math.round(
      (now.getTime() - new Date(timesheet.started_at).getTime()) / 60_000,
    ),
  )
  const activeBreakMinutes =
    timesheet.clock_state === 'on_break' && timesheet.break_started_at
      ? Math.max(
          0,
          Math.round(
            (now.getTime() - new Date(timesheet.break_started_at).getTime()) /
              60_000,
          ),
        )
      : 0
  const payableMinutes = Math.max(
    0,
    elapsedMinutes - Number(timesheet.break_minutes || 0) - activeBreakMinutes,
  )

  return {
    work_date: timesheet.work_date,
    payable_minutes: payableMinutes,
    gross_pay: round2(
      (payableMinutes / 60) * Number(timesheet.hourly_rate || 0),
    ),
    isLive: true,
  }
}

function summarize(
  jobs: number,
  revenue: number,
  jobHours: number,
  paidHours: number,
  grossWages: number,
): Omit<TechMonthRow, 'month'> {
  const hourBase = paidHours > 0 ? paidHours : jobHours
  return {
    jobs,
    revenue: round2(revenue),
    jobHours: round1(jobHours),
    paidHours: round1(paidHours),
    grossWages: round2(grossWages),
    revenuePerPaidHour: hourBase > 0 ? round2(revenue / hourBase) : 0,
    laborPercent: revenue > 0 ? round1((grossWages / revenue) * 100) : 0,
    billableEfficiency:
      paidHours > 0 ? round1((jobHours / paidHours) * 100) : 0,
    profitAfterWages: round2(revenue - grossWages),
  }
}

export function buildTechDayRows(
  appointments: ApptInput[],
  timesheets: TimesheetInput[],
): TechDayRow[] {
  type Acc = {
    jobs: number
    revenue: number
    jobHours: number
    paidHours: number
    grossWages: number
    isLive: boolean
  }
  const byDay = new Map<string, Acc>()
  const acc = (date: string): Acc => {
    let a = byDay.get(date)
    if (!a) {
      a = {
        jobs: 0,
        revenue: 0,
        jobHours: 0,
        paidHours: 0,
        grossWages: 0,
        isLive: false,
      }
      byDay.set(date, a)
    }
    return a
  }

  for (const appt of appointments) {
    const a = acc(appt.appointment_date.slice(0, 10))
    a.jobs++
    a.revenue += appt.revenue
    a.jobHours += appt.hours
  }
  for (const ts of timesheets) {
    const a = acc(ts.work_date.slice(0, 10))
    a.paidHours += (ts.payable_minutes || 0) / 60
    a.grossWages += ts.gross_pay || 0
    a.isLive ||= !!ts.isLive
  }

  return [...byDay.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([date, a]) => {
      const summary = summarize(
        a.jobs,
        a.revenue,
        a.jobHours,
        a.paidHours,
        a.grossWages,
      )
      const hourBase = a.paidHours > 0 ? a.paidHours : a.jobHours
      return {
        date,
        ...summary,
        profitPerHour:
          hourBase > 0
            ? round2((summary.revenue - summary.grossWages) / hourBase)
            : 0,
        isLive: a.isLive,
      }
    })
}

export function buildTechMonthRows(
  appointments: ApptInput[],
  timesheets: TimesheetInput[],
): { months: TechMonthRow[]; totals: Omit<TechMonthRow, 'month'> } {
  type Acc = {
    jobs: number
    revenue: number
    jobHours: number
    paidHours: number
    grossWages: number
  }
  const byMonth = new Map<string, Acc>()
  const acc = (month: string): Acc => {
    let a = byMonth.get(month)
    if (!a) {
      a = { jobs: 0, revenue: 0, jobHours: 0, paidHours: 0, grossWages: 0 }
      byMonth.set(month, a)
    }
    return a
  }

  for (const appt of appointments) {
    const a = acc(appt.appointment_date.slice(0, 7))
    a.jobs++
    a.revenue += appt.revenue
    a.jobHours += appt.hours
  }
  for (const ts of timesheets) {
    const a = acc(ts.work_date.slice(0, 7))
    a.paidHours += (ts.payable_minutes || 0) / 60
    a.grossWages += ts.gross_pay || 0
  }

  const months = [...byMonth.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([month, a]) => ({
      month,
      ...summarize(a.jobs, a.revenue, a.jobHours, a.paidHours, a.grossWages),
    }))

  const t = [...byMonth.values()].reduce(
    (s, a) => ({
      jobs: s.jobs + a.jobs,
      revenue: s.revenue + a.revenue,
      jobHours: s.jobHours + a.jobHours,
      paidHours: s.paidHours + a.paidHours,
      grossWages: s.grossWages + a.grossWages,
    }),
    { jobs: 0, revenue: 0, jobHours: 0, paidHours: 0, grossWages: 0 },
  )

  return {
    months,
    totals: summarize(t.jobs, t.revenue, t.jobHours, t.paidHours, t.grossWages),
  }
}

export async function loadTechPerformance(
  supabase: SupabaseClient,
  options?: { sinceDate?: string },
): Promise<TechPerformance[]> {
  const since = options?.sinceDate ?? null

  const { data: techs } = await supabase
    .from('staff_users')
    .select('id, display_name, role, is_active')
    .eq('is_active', true)
    .eq('role', 'tech')

  if (!techs || techs.length === 0) return []

  const results: TechPerformance[] = []

  for (const tech of techs) {
    let apptQuery = supabase
      .from('ops_appointments')
      .select(
        `
        appointment_date,
        start_time,
        end_time,
        quoted_total,
        on_my_way_at,
        completed_at,
        kind,
        visit_type,
        ops_invoices (
          total,
          ops_invoice_line_items ( line_total )
        )
      `,
      )
      .eq('assigned_staff_user_id', tech.id)
      .eq('status', 'completed')
    if (since) apptQuery = apptQuery.gte('appointment_date', since)

    let tsQuery = supabase
      .from('ops_timesheet_entries')
      .select(
        'work_date, payable_minutes, gross_pay, started_at, break_minutes, hourly_rate, clock_state, break_started_at',
      )
      .eq('staff_user_id', tech.id)
    if (since) tsQuery = tsQuery.gte('work_date', since)

    const [{ data: appts }, { data: timesheets }] = await Promise.all([
      apptQuery,
      tsQuery,
    ])

    const apptInputs: ApptInput[] = (appts || [])
      .filter((a) => a.appointment_date)
      .map((a) => {
        const inv = Array.isArray(a.ops_invoices)
          ? a.ops_invoices[0]
          : a.ops_invoices
        const lineItems = Array.isArray(inv?.ops_invoice_line_items)
          ? inv.ops_invoice_line_items
          : inv?.ops_invoice_line_items
            ? [inv.ops_invoice_line_items]
            : []
        /**
         * A water loss invoices once, at the close, and that invoice hangs off
         * whichever visit it was closed from. Crediting the assigned tech with
         * the whole invoice therefore hands an entire flood to whoever
         * happened to be on the last trip.
         *
         * That is exactly what happened on the Benns loss: David was assigned
         * the two-hour equipment pickup and the report credited him the full
         * $4,052.46. Charles: "He doesn't deserve any credit for it for
         * revenue whatsoever. I know he picked up the equipment, but that's
         * literally all he did."
         *
         * The money follows the mitigation day, where the work is. Monitors
         * and the final pickup still count their hours — the trip happened —
         * but carry no revenue of their own.
         */
        const isRestoration =
          (a as { kind?: string | null }).kind === 'restoration' ||
          Boolean((a as { visit_type?: string | null }).visit_type)
        const isMitigation =
          (a as { visit_type?: string | null }).visit_type === 'mitigation'
        const revenue =
          isRestoration && !isMitigation
            ? 0
            : effectiveInvoiceAmount({
                invoiceTotal: Number(inv?.total || 0),
                invoiceLineItems: lineItems,
                quotedTotal: Number(a.quoted_total || 0),
              })

        return {
          appointment_date: String(a.appointment_date),
          revenue,
          hours: utilizationHoursFromAppointment(a),
        }
      })

    const now = new Date()
    const timesheetInputs = ((timesheets || []) as StoredTimesheetInput[]).map(
      (timesheet) => timesheetInputAt(timesheet, now),
    )
    const { months, totals } = buildTechMonthRows(apptInputs, timesheetInputs)
    const days = buildTechDayRows(apptInputs, timesheetInputs)

    if (months.length === 0) continue

    results.push({
      staffUserId: tech.id,
      displayName: tech.display_name,
      days,
      months,
      totals,
    })
  }

  return results
}
