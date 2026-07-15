import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'
import { businessToday } from '@/lib/ops/capacity'
import { getSlotsForStaff } from '@/lib/ops/staff-availability'
import { getActiveStaff } from '@/lib/ops/staff'

/**
 * Retention, recurring-base, and booked-out metrics for the stats page.
 * All figures are ops-era only (ops_appointments began ~April 2026) — there
 * is no pre-ops service history in the DB, so repeat rates will read low
 * until the data covers a full recleaning cycle (6–12 months).
 */

export type DueCustomer = {
  customerId: string
  name: string
  lastService: string
  jobs: number
  lifetimeValue: number
  monthsSince: number
}

export type RetentionSummary = {
  sinceDate: string
  customers: number
  repeatCustomers: number
  repeatRatePct: number
  repeatRevenue: number
  totalRevenue: number
  avgCustomerValue: number
  medianDaysBetweenVisits: number | null
  dueSoonCount: number // last clean 3–6 months ago
  overdueCount: number // last clean 6+ months ago
  dueList: DueCustomer[] // top by lifetime value, due soon + overdue
}

export type RecurringSummary = {
  completedRevenue: number
  completedJobs: number
  bookedRevenue: number
  bookedJobs: number
  pctOfCompletedRevenue: number
}

export type BookedOutEntry = {
  staffUserId: string
  staffName: string
  /** Days until the next 2-hour opening; null = nothing within the scan window. */
  daysOut: number | null
  nextOpenDate: string | null
}

export type BusinessHealth = {
  retention: RetentionSummary
  recurring: RecurringSummary
  bookedOut: BookedOutEntry[]
  bookedOutScanDays: number
}

type CompletedJob = {
  customer_id: string
  customer_name: string
  appointment_date: string
  revenue: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const DAY_MS = 86400000

export function computeRetention(
  jobs: CompletedJob[],
  today: string,
): RetentionSummary {
  type Cust = {
    name: string
    dates: string[]
    revenue: number
  }
  const byCustomer = new Map<string, Cust>()
  let sinceDate = today

  for (const job of jobs) {
    if (job.appointment_date < sinceDate) sinceDate = job.appointment_date
    let c = byCustomer.get(job.customer_id)
    if (!c) {
      c = { name: job.customer_name, dates: [], revenue: 0 }
      byCustomer.set(job.customer_id, c)
    }
    c.dates.push(job.appointment_date)
    c.revenue += job.revenue
  }

  const customers = byCustomer.size
  let repeatCustomers = 0
  let repeatRevenue = 0
  let totalRevenue = 0
  const gaps: number[] = []
  const due: DueCustomer[] = []
  const todayMs = Date.parse(`${today}T00:00:00Z`)

  for (const [id, c] of byCustomer) {
    c.dates.sort()
    totalRevenue += c.revenue
    // Distinct service days — same-day multi-appointments are one visit.
    const days = [...new Set(c.dates)]
    if (days.length > 1) {
      repeatCustomers++
      repeatRevenue += c.revenue
      for (let i = 1; i < days.length; i++) {
        gaps.push(
          Math.round(
            (Date.parse(`${days[i]}T00:00:00Z`) -
              Date.parse(`${days[i - 1]}T00:00:00Z`)) /
              DAY_MS,
          ),
        )
      }
    }
    const last = days[days.length - 1]
    const monthsSince =
      (todayMs - Date.parse(`${last}T00:00:00Z`)) / DAY_MS / 30.44
    if (monthsSince >= 3) {
      due.push({
        customerId: id,
        name: c.name,
        lastService: last,
        jobs: days.length,
        lifetimeValue: round2(c.revenue),
        monthsSince: round1(monthsSince),
      })
    }
  }

  gaps.sort((a, b) => a - b)
  const medianDaysBetweenVisits =
    gaps.length > 0
      ? gaps.length % 2 === 1
        ? gaps[(gaps.length - 1) / 2]
        : Math.round((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2)
      : null

  due.sort((a, b) => b.lifetimeValue - a.lifetimeValue)

  return {
    sinceDate,
    customers,
    repeatCustomers,
    repeatRatePct:
      customers > 0 ? round1((repeatCustomers / customers) * 100) : 0,
    repeatRevenue: round2(repeatRevenue),
    totalRevenue: round2(totalRevenue),
    avgCustomerValue: customers > 0 ? round2(totalRevenue / customers) : 0,
    medianDaysBetweenVisits,
    dueSoonCount: due.filter((d) => d.monthsSince < 6).length,
    overdueCount: due.filter((d) => d.monthsSince >= 6).length,
    dueList: due.slice(0, 15),
  }
}

export async function loadBusinessHealth(
  supabase: SupabaseClient,
): Promise<BusinessHealth> {
  const today = businessToday()
  const yearStart = `${today.slice(0, 4)}-01-01`

  const { data: appts, error: apptsError } = await supabase
    .from('ops_appointments')
    .select(
      `
      customer_id,
      appointment_date,
      status,
      quoted_total,
      recurring_template_id,
      ops_customers!ops_appointments_customer_id_fkey ( full_name, first_name, last_name, business_name ),
      ops_invoices ( total, ops_invoice_line_items ( line_total ) )
    `,
    )
    .neq('status', 'cancelled')

  if (apptsError) throw apptsError

  const completed: CompletedJob[] = []
  let recurringCompletedRevenue = 0
  let recurringCompletedJobs = 0
  let recurringBookedRevenue = 0
  let recurringBookedJobs = 0
  let completedOpsRevenueYtd = 0

  for (const a of appts || []) {
    if (!a.appointment_date) continue
    const inv = Array.isArray(a.ops_invoices)
      ? a.ops_invoices[0]
      : a.ops_invoices
    const lineItems = Array.isArray(inv?.ops_invoice_line_items)
      ? inv.ops_invoice_line_items
      : inv?.ops_invoice_line_items
        ? [inv.ops_invoice_line_items]
        : []
    const revenue = effectiveInvoiceAmount({
      invoiceTotal: Number(inv?.total || 0),
      invoiceLineItems: lineItems,
      quotedTotal: Number(a.quoted_total || 0),
    })

    const cust = Array.isArray(a.ops_customers)
      ? a.ops_customers[0]
      : a.ops_customers
    const name =
      cust?.business_name ||
      cust?.full_name ||
      [cust?.first_name, cust?.last_name].filter(Boolean).join(' ') ||
      'Unknown'

    if (a.status === 'completed') {
      // Retention tracks one-time/residential behavior — recurring contract
      // visits are scheduled, not "the customer came back", and belong to
      // the Recurring Base numbers instead.
      if (a.customer_id && !a.recurring_template_id) {
        completed.push({
          customer_id: String(a.customer_id),
          customer_name: name,
          appointment_date: String(a.appointment_date),
          revenue,
        })
      }
      if (a.appointment_date >= yearStart) {
        completedOpsRevenueYtd += revenue
        if (a.recurring_template_id) {
          recurringCompletedRevenue += revenue
          recurringCompletedJobs++
        }
      }
    } else if (a.appointment_date >= today && a.recurring_template_id) {
      recurringBookedRevenue += revenue
      recurringBookedJobs++
    }
  }

  const retention = computeRetention(completed, today)

  const recurring: RecurringSummary = {
    completedRevenue: round2(recurringCompletedRevenue),
    completedJobs: recurringCompletedJobs,
    bookedRevenue: round2(recurringBookedRevenue),
    bookedJobs: recurringBookedJobs,
    pctOfCompletedRevenue:
      completedOpsRevenueYtd > 0
        ? round1((recurringCompletedRevenue / completedOpsRevenueYtd) * 100)
        : 0,
  }

  // Booked-out: first day (within the scan window) where each tech has a
  // 2-hour opening, using the same availability logic as booking.
  const SCAN_DAYS = 21
  const staff = await getActiveStaff(supabase)
  const bookedOut: BookedOutEntry[] = []
  const todayMs = Date.parse(`${today}T00:00:00Z`)

  for (const s of staff) {
    let found: { daysOut: number; date: string } | null = null
    for (let d = 0; d < SCAN_DAYS; d++) {
      const date = new Date(todayMs + d * DAY_MS).toISOString().split('T')[0]
      const slots = await getSlotsForStaff({
        supabase,
        date,
        requiredMinutes: 120,
        staffUserId: s.id,
        maxResults: 1,
      })
      if (slots.length > 0) {
        found = { daysOut: d, date }
        break
      }
    }
    bookedOut.push({
      staffUserId: s.id,
      staffName: s.display_name,
      daysOut: found ? found.daysOut : null,
      nextOpenDate: found ? found.date : null,
    })
  }

  return { retention, recurring, bookedOut, bookedOutScanDays: SCAN_DAYS }
}
