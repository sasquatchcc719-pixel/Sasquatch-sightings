import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'
import { businessToday } from '@/lib/ops/capacity'
import { getSlotsForStaff } from '@/lib/ops/staff-availability'
import { getActiveStaff } from '@/lib/ops/staff'

/**
 * Retention, recurring-base, and booked-out metrics for the stats page.
 *
 * Retention blends two eras: ops_appointments (April 2026+) and
 * hcp_customer_history — last service date + lifetime value per customer
 * from the Housecall Pro years, recovered from the June 2026 exports. A
 * customer with an HCP service date who later completed an ops job counts
 * as a repeat (they came back across systems).
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
  /** Average per-visit ticket (ops completed jobs) — used for pipeline value. */
  avgTicket: number
  medianDaysBetweenVisits: number | null
  hcpCustomers: number
  crossSystemRepeats: number
  dueSoonCount: number // last clean 3–6 months ago
  overdueCount: number // last clean 6+ months ago
  dueList: DueCustomer[] // top by lifetime value, due soon + overdue
}

export type HcpHistoryRow = {
  hcp_id: string
  customer_name: string | null
  last_service_date_hcp: string | null
  lifetime_value: number
  ops_customer_id: string | null
  do_not_contact: boolean
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

/** Visit days closer together than this merge into one service episode. */
const EPISODE_GAP_DAYS = 14

export type PreOpsVisit = {
  /** Resolved customer key (ops customer id, or ext:/qb: synthetic key). */
  customerKey: string
  name: string
  date: string
  amount: number
}

export function computeRetention(
  jobs: CompletedJob[],
  today: string,
  options?: {
    /** HCP snapshot: DNC flags + fallback last-date/value when no QB visits. */
    hcp?: HcpHistoryRow[]
    /** Visit-level QuickBooks history from before the ops era. */
    preOpsVisits?: PreOpsVisit[]
    /** ops customer ids with a future booking — not "due", they're coming. */
    bookedCustomerIds?: Set<string>
  },
): RetentionSummary {
  type Cust = {
    name: string
    visits: Map<string, number> // date → dollars that day
    opsDays: Set<string>
    revenue: number
    doNotContact: boolean
  }
  const byCustomer = new Map<string, Cust>()
  const getCust = (key: string, name: string): Cust => {
    let c = byCustomer.get(key)
    if (!c) {
      c = {
        name,
        visits: new Map(),
        opsDays: new Set(),
        revenue: 0,
        doNotContact: false,
      }
      byCustomer.set(key, c)
    }
    return c
  }
  const addVisit = (c: Cust, date: string, amount: number) => {
    c.visits.set(date, (c.visits.get(date) || 0) + amount)
    c.revenue += amount
  }

  let opsJobCount = 0
  let opsRevenue = 0
  for (const job of jobs) {
    const c = getCust(job.customer_id, job.customer_name)
    addVisit(c, job.appointment_date, job.revenue)
    c.opsDays.add(job.appointment_date)
    opsJobCount++
    opsRevenue += job.revenue
  }

  for (const v of options?.preOpsVisits || []) {
    if (!v.date) continue
    addVisit(getCust(v.customerKey, v.name), v.date, v.amount)
  }

  // HCP snapshot: QuickBooks already contains HCP-era invoices, so a customer
  // with QB visits gets only the DNC flag from here. Customers with no QB
  // history use the HCP last-date + lifetime value as their one known visit.
  for (const h of options?.hcp || []) {
    const key = h.ops_customer_id || `hcp:${h.hcp_id}`
    const existing = byCustomer.get(key)
    if (existing) {
      existing.doNotContact = existing.doNotContact || h.do_not_contact
      const hasPreOpsVisits = [...existing.visits.keys()].some(
        (d) => !existing.opsDays.has(d),
      )
      if (!hasPreOpsVisits && h.last_service_date_hcp) {
        addVisit(existing, h.last_service_date_hcp, h.lifetime_value || 0)
      }
    } else if (h.last_service_date_hcp) {
      const c = getCust(key, h.customer_name || 'Unknown')
      c.doNotContact = h.do_not_contact
      addVisit(c, h.last_service_date_hcp, h.lifetime_value || 0)
    }
  }

  let sinceDate = today
  let customers = 0
  let repeatCustomers = 0
  let crossSystemRepeats = 0
  let historicalCustomers = 0
  let repeatRevenue = 0
  let totalRevenue = 0
  const gaps: number[] = []
  const due: DueCustomer[] = []
  const todayMs = Date.parse(`${today}T00:00:00Z`)
  const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS

  for (const [id, c] of byCustomer) {
    const days = [...c.visits.keys()].sort()
    if (days.length === 0) continue
    customers++
    totalRevenue += c.revenue
    if (days[0] < sinceDate) sinceDate = days[0]

    // Cluster visit days into service episodes (multi-day projects = one job).
    const episodes: { start: string; end: string }[] = []
    for (const day of days) {
      const prev = episodes[episodes.length - 1]
      if (prev && dayNum(day) - dayNum(prev.end) <= EPISODE_GAP_DAYS) {
        prev.end = day
      } else {
        episodes.push({ start: day, end: day })
      }
    }

    const hasOps = c.opsDays.size > 0
    const hasPreOps = days.some((d) => !c.opsDays.has(d))
    if (hasPreOps) historicalCustomers++

    if (episodes.length > 1) {
      repeatCustomers++
      repeatRevenue += c.revenue
      if (hasOps && hasPreOps) crossSystemRepeats++
      for (let i = 1; i < episodes.length; i++) {
        gaps.push(
          Math.round(dayNum(episodes[i].start) - dayNum(episodes[i - 1].end)),
        )
      }
    }

    const last = episodes[episodes.length - 1].end
    const monthsSince =
      (todayMs - Date.parse(`${last}T00:00:00Z`)) / DAY_MS / 30.44
    const hasFutureBooking = options?.bookedCustomerIds?.has(id) ?? false
    if (monthsSince >= 3 && !c.doNotContact && !hasFutureBooking) {
      due.push({
        customerId: id,
        name: c.name,
        lastService: last,
        jobs: episodes.length,
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
    avgTicket: opsJobCount > 0 ? round2(opsRevenue / opsJobCount) : 0,
    medianDaysBetweenVisits,
    hcpCustomers: historicalCustomers,
    crossSystemRepeats,
    dueSoonCount: due.filter((d) => d.monthsSince < 6).length,
    overdueCount: due.filter((d) => d.monthsSince >= 6).length,
    dueList: due.slice(0, 20),
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

  const [{ data: hcpRows }, { data: qbRows }, { data: custRows }] =
    await Promise.all([
      supabase
        .from('hcp_customer_history')
        .select(
          'hcp_id, customer_name, last_service_date_hcp, lifetime_value, ops_customer_id, do_not_contact',
        ),
      supabase
        .from('qb_historical_transactions')
        .select('txn_date, total, qb_customer_id, customer_name')
        .not('txn_date', 'is', null),
      supabase
        .from('ops_customers')
        .select(
          'id, quickbooks_customer_id, full_name, first_name, last_name, business_name',
        ),
    ])

  const completed: CompletedJob[] = []
  const bookedCustomerIds = new Set<string>()
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

    if (
      a.status !== 'completed' &&
      a.appointment_date >= today &&
      a.customer_id
    ) {
      bookedCustomerIds.add(String(a.customer_id))
    }

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

  // Resolve QuickBooks-era transactions to customers: QB id → ops customer,
  // else normalized name, else a synthetic key. HCP rows get the same name
  // fallback so one person never appears under two keys.
  const normName = (n: string | null | undefined) =>
    (n || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const opsByQbId = new Map<string, string>()
  const opsByName = new Map<string, string>()
  for (const c of custRows || []) {
    if (c.quickbooks_customer_id) {
      opsByQbId.set(String(c.quickbooks_customer_id), c.id)
    }
    for (const n of [
      c.business_name,
      c.full_name,
      [c.first_name, c.last_name].filter(Boolean).join(' '),
    ]) {
      const key = normName(n)
      if (key && !opsByName.has(key)) opsByName.set(key, c.id)
    }
  }
  const resolveKey = (
    qbCustomerId: string | null,
    name: string | null,
  ): string => {
    if (qbCustomerId && opsByQbId.has(qbCustomerId)) {
      return opsByQbId.get(qbCustomerId)!
    }
    const nn = normName(name)
    if (nn && opsByName.has(nn)) return opsByName.get(nn)!
    if (nn) return `ext:${nn}`
    return `qb:${qbCustomerId || 'unknown'}`
  }

  // Only QB transactions from before the ops era are history — later ones
  // are the sync mirroring ops invoices and would double count.
  const opsEraStart =
    completed.length > 0
      ? completed.reduce(
          (min, j) => (j.appointment_date < min ? j.appointment_date : min),
          today,
        )
      : today
  const preOpsVisits: PreOpsVisit[] = (qbRows || [])
    .filter((r) => r.txn_date && r.txn_date < opsEraStart)
    .map((r) => ({
      customerKey: resolveKey(
        r.qb_customer_id ? String(r.qb_customer_id) : null,
        r.customer_name,
      ),
      name: r.customer_name || 'Unknown',
      date: String(r.txn_date),
      amount: Number(r.total || 0),
    }))

  const retention = computeRetention(completed, today, {
    hcp: (hcpRows || []).map((h) => ({
      ...h,
      ops_customer_id:
        h.ops_customer_id ||
        opsByName.get(normName(h.customer_name)) ||
        (normName(h.customer_name) ? `ext:${normName(h.customer_name)}` : null),
      lifetime_value: Number(h.lifetime_value || 0),
    })) as HcpHistoryRow[],
    preOpsVisits,
    bookedCustomerIds,
  })

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
