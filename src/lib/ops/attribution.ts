import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CANONICAL_LEAD_SOURCE_OPTIONS,
  isLeadSourceKey,
  normalizeLeadSource,
  type LeadSourceKey,
} from '@/lib/lead-sources'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'

/**
 * The single revenue-attribution engine. Every lead-source analytics surface
 * should read from here so the numbers agree.
 *
 * First-touch model: a job's revenue is credited to the channel that
 * originally won the CUSTOMER, not to how this particular job arrived.
 *  - A job with its own real source keeps it.
 *  - "Repeat customer" jobs and recurring/NULL jobs inherit the customer's
 *    earliest real source, so Nextdoor gets credit for the lifetime of a
 *    customer it won — not just their first ticket.
 *  - Customers with a business_name are Commercial: not a marketing channel,
 *    reported in their own bucket so Recovery Village etc. stop inflating
 *    Other / Unattributed.
 *  - When no job in the customer's history has a real source, the revenue is
 *    reported as "Unattributed" rather than silently dropped, so the share
 *    of money we genuinely can't explain stays visible.
 */

export const UNATTRIBUTED_KEY = 'unattributed'
/** Customers with a business_name — not a marketing channel. */
export const COMMERCIAL_KEY = 'commercial'
export const REPEAT_KEY: LeadSourceKey = 'repeat_customer'

export type AttributionRow = {
  id: string
  customer_id: string | null
  customer_name: string
  appointment_date: string | null
  status: string
  kind: string | null
  lead_source: string | null
  lead_source_key: string | null
  revenue: number
  /**
   * True when the customer has a business_name. Commercial accounts are not
   * marketing-channel leads; they roll into their own reporting bucket so they
   * stop inflating Other / Unattributed.
   */
  is_commercial: boolean
}

export type ResolvedAttribution = {
  /** Effective first-touch key ('unattributed' when unknown). */
  key: string
  /** True when the key was inherited from an earlier job of the customer. */
  inherited: boolean
  /** True for jobs that arrived as repeat/recurring rather than new demand. */
  isReturn: boolean
}

/** The job's own directly-recorded key, if it has a real one. */
function ownKey(row: {
  lead_source: string | null
  lead_source_key: string | null
}): string | null {
  if (row.lead_source_key && isLeadSourceKey(row.lead_source_key)) {
    return row.lead_source_key
  }
  if (row.lead_source) {
    // normalizeLeadSource never returns null — unknown text maps to 'other',
    // which is correct here: a recorded-but-unrecognized source is still a
    // recorded source, not a candidate for inheritance.
    return normalizeLeadSource(row.lead_source).source_key
  }
  return null
}

export function resolveAttribution(
  rows: AttributionRow[],
): Map<string, ResolvedAttribution> {
  // Earliest real (non-repeat) source per customer = acquisition channel.
  type FirstTouch = { key: string; date: string }
  const firstTouch = new Map<string, FirstTouch>()

  for (const row of rows) {
    if (!row.customer_id || !row.appointment_date) continue
    if (row.is_commercial) continue
    const key = ownKey(row)
    if (!key || key === REPEAT_KEY) continue
    const existing = firstTouch.get(row.customer_id)
    if (!existing || row.appointment_date < existing.date) {
      firstTouch.set(row.customer_id, {
        key,
        date: row.appointment_date,
      })
    }
  }

  const resolved = new Map<string, ResolvedAttribution>()
  for (const row of rows) {
    const own = ownKey(row)
    const isReturn = own === REPEAT_KEY || own === null

    // Commercial accounts are a customer designation, not a lead source.
    // They never inherit a residential marketing channel.
    if (row.is_commercial) {
      resolved.set(row.id, {
        key: COMMERCIAL_KEY,
        inherited: false,
        isReturn,
      })
      continue
    }

    if (own && own !== REPEAT_KEY) {
      resolved.set(row.id, { key: own, inherited: false, isReturn: false })
      continue
    }
    const inherited = row.customer_id
      ? firstTouch.get(row.customer_id)
      : undefined
    if (inherited) {
      resolved.set(row.id, { key: inherited.key, inherited: true, isReturn })
      continue
    }
    // Known-repeat customer with unknown origin keeps the repeat bucket so
    // the revenue stays visible; everything else is Unattributed.
    resolved.set(row.id, {
      key: own === REPEAT_KEY ? REPEAT_KEY : UNATTRIBUTED_KEY,
      inherited: false,
      isReturn,
    })
  }
  return resolved
}

export type AttributedSource = {
  lead_source_key: string
  /** Human label (canonical customer label, or Unattributed). */
  lead_source: string
  booking_count: number
  completed_count: number
  total_revenue: number
  avg_ticket: number
  percentage: number
  /** Revenue from repeat/recurring jobs credited back to this channel. */
  return_revenue: number
  /** Jobs whose attribution was inherited rather than directly recorded. */
  inherited_count: number
}

export type AttributionSummary = {
  sources: AttributedSource[]
  total_bookings: number
  total_revenue: number
  /** Share of revenue with a real (non-unattributed) channel, 0–100. */
  attributed_revenue_pct: number
  date_range: { start: string; end: string }
}

export function labelForAttributionKey(key: string): string {
  if (key === UNATTRIBUTED_KEY) return 'Unattributed'
  if (key === COMMERCIAL_KEY) return 'Commercial'
  const option = CANONICAL_LEAD_SOURCE_OPTIONS.find((o) => o.source_key === key)
  return option?.customer_label ?? key
}

export function summarizeAttribution(
  rows: AttributionRow[],
  options: { startDate: string; endDate: string },
): AttributionSummary {
  const resolved = resolveAttribution(rows)

  type Acc = {
    bookings: number
    completed: number
    revenue: number
    returnRevenue: number
    inherited: number
  }
  const byKey = new Map<string, Acc>()

  for (const row of rows) {
    if (row.kind === 'estimate') continue
    if (!row.appointment_date) continue
    if (
      row.appointment_date < options.startDate ||
      row.appointment_date > options.endDate
    ) {
      continue
    }
    const attribution = resolved.get(row.id)
    if (!attribution) continue

    let acc = byKey.get(attribution.key)
    if (!acc) {
      acc = {
        bookings: 0,
        completed: 0,
        revenue: 0,
        returnRevenue: 0,
        inherited: 0,
      }
      byKey.set(attribution.key, acc)
    }
    acc.bookings++
    if (attribution.inherited) acc.inherited++
    if (row.status === 'completed') {
      acc.completed++
      acc.revenue += row.revenue
      if (attribution.isReturn) acc.returnRevenue += row.revenue
    }
  }

  const totalBookings = [...byKey.values()].reduce((s, a) => s + a.bookings, 0)
  const totalRevenue = [...byKey.values()].reduce((s, a) => s + a.revenue, 0)
  const unattributedRevenue = byKey.get(UNATTRIBUTED_KEY)?.revenue ?? 0

  const sources: AttributedSource[] = [...byKey.entries()]
    .map(([key, a]) => ({
      lead_source_key: key,
      lead_source: labelForAttributionKey(key),
      booking_count: a.bookings,
      completed_count: a.completed,
      total_revenue: Math.round(a.revenue * 100) / 100,
      avg_ticket:
        a.completed > 0 ? Math.round((a.revenue / a.completed) * 100) / 100 : 0,
      percentage:
        totalBookings > 0
          ? Math.round((a.bookings / totalBookings) * 1000) / 10
          : 0,
      return_revenue: Math.round(a.returnRevenue * 100) / 100,
      inherited_count: a.inherited,
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)

  return {
    sources,
    total_bookings: totalBookings,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    attributed_revenue_pct:
      totalRevenue > 0
        ? Math.round(
            ((totalRevenue - unattributedRevenue) / totalRevenue) * 1000,
          ) / 10
        : 100,
    date_range: { start: options.startDate, end: options.endDate },
  }
}

/** Load every appointment needed for attribution (full history, so
 * first-touch inheritance sees jobs outside the reporting window). */
export async function loadAttributionRows(
  supabase: SupabaseClient,
): Promise<AttributionRow[]> {
  const { data, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id, customer_id, appointment_date, status, kind,
      lead_source, lead_source_key, quoted_total,
      ops_customers!ops_appointments_customer_id_fkey (
        full_name,
        business_name,
        is_commercial
      ),
      ops_invoices ( total, ops_invoice_line_items ( line_total ) )
    `,
    )
    .neq('status', 'cancelled')
    .limit(20000)

  if (error) throw error

  return (data || []).map((a) => {
    const inv = Array.isArray(a.ops_invoices)
      ? a.ops_invoices[0]
      : a.ops_invoices
    const lineItems = Array.isArray(inv?.ops_invoice_line_items)
      ? inv.ops_invoice_line_items
      : inv?.ops_invoice_line_items
        ? [inv.ops_invoice_line_items]
        : []
    const customer = Array.isArray(a.ops_customers)
      ? a.ops_customers[0]
      : a.ops_customers
    const businessName = String(
      (customer as { business_name?: string | null } | null)?.business_name ||
        '',
    ).trim()
    const fullName = String(
      (customer as { full_name?: string | null } | null)?.full_name || '',
    ).trim()
    const flaggedCommercial = Boolean(
      (customer as { is_commercial?: boolean | null } | null)?.is_commercial,
    )
    return {
      id: String(a.id),
      customer_id: a.customer_id ? String(a.customer_id) : null,
      customer_name: businessName || fullName || 'Unknown customer',
      appointment_date: a.appointment_date ? String(a.appointment_date) : null,
      status: String(a.status),
      kind: a.kind ? String(a.kind) : null,
      lead_source: a.lead_source,
      lead_source_key: a.lead_source_key,
      is_commercial: flaggedCommercial || businessName.length > 0,
      revenue: effectiveInvoiceAmount({
        invoiceTotal: Number(inv?.total || 0),
        invoiceLineItems: lineItems,
        quotedTotal: Number(a.quoted_total || 0),
        kind: a.kind ? String(a.kind) : null,
      }),
    }
  })
}

export type AttributedJobDetail = {
  id: string
  appointment_date: string
  customer_id: string | null
  customer_name: string
  status: string
  kind: string | null
  revenue: number
  inherited: boolean
  is_return: boolean
}

export type AttributedCustomerDetail = {
  customer_id: string | null
  customer_name: string
  job_count: number
  completed_count: number
  total_revenue: number
  jobs: AttributedJobDetail[]
}

export type AttributedSourceDetails = {
  lead_source_key: string
  lead_source: string
  customers: AttributedCustomerDetail[]
  job_count: number
  completed_count: number
  total_revenue: number
}

/** Jobs attributed to one channel in a window, rolled up by customer. */
export async function loadAttributedSourceDetails(
  supabase: SupabaseClient,
  options: { startDate: string; endDate: string; sourceKey: string },
): Promise<AttributedSourceDetails> {
  const rows = await loadAttributionRows(supabase)
  const resolved = resolveAttribution(rows)
  const jobs: AttributedJobDetail[] = []

  for (const row of rows) {
    if (row.kind === 'estimate') continue
    if (!row.appointment_date) continue
    if (
      row.appointment_date < options.startDate ||
      row.appointment_date > options.endDate
    ) {
      continue
    }
    const attribution = resolved.get(row.id)
    if (!attribution || attribution.key !== options.sourceKey) continue
    jobs.push({
      id: row.id,
      appointment_date: row.appointment_date,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      status: row.status,
      kind: row.kind,
      revenue: row.status === 'completed' ? row.revenue : 0,
      inherited: attribution.inherited,
      is_return: attribution.isReturn,
    })
  }

  const byCustomer = new Map<string, AttributedCustomerDetail>()
  for (const job of jobs) {
    const key = job.customer_id || `anon:${job.customer_name}`
    let customer = byCustomer.get(key)
    if (!customer) {
      customer = {
        customer_id: job.customer_id,
        customer_name: job.customer_name,
        job_count: 0,
        completed_count: 0,
        total_revenue: 0,
        jobs: [],
      }
      byCustomer.set(key, customer)
    }
    customer.job_count++
    if (job.status === 'completed') {
      customer.completed_count++
      customer.total_revenue += job.revenue
    }
    customer.jobs.push(job)
  }

  const customers = [...byCustomer.values()]
    .map((customer) => ({
      ...customer,
      total_revenue: Math.round(customer.total_revenue * 100) / 100,
      jobs: customer.jobs.sort((a, b) =>
        b.appointment_date.localeCompare(a.appointment_date),
      ),
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)

  return {
    lead_source_key: options.sourceKey,
    lead_source: labelForAttributionKey(options.sourceKey),
    customers,
    job_count: jobs.length,
    completed_count: jobs.filter((j) => j.status === 'completed').length,
    total_revenue:
      Math.round(customers.reduce((sum, c) => sum + c.total_revenue, 0) * 100) /
      100,
  }
}

export async function loadAttributedLeadSources(
  supabase: SupabaseClient,
  options: { startDate: string; endDate: string },
): Promise<AttributionSummary> {
  const rows = await loadAttributionRows(supabase)
  return summarizeAttribution(rows, options)
}

/**
 * The customer's acquisition source, for stamping onto newly generated
 * repeat/recurring appointments at write time.
 */
export async function firstTouchForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ lead_source: string; lead_source_key: string } | null> {
  const { data } = await supabase
    .from('ops_appointments')
    .select('appointment_date, lead_source, lead_source_key')
    .eq('customer_id', customerId)
    .neq('status', 'cancelled')
    .not('lead_source_key', 'is', null)
    .neq('lead_source_key', REPEAT_KEY)
    .order('appointment_date', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data?.lead_source_key || !isLeadSourceKey(data.lead_source_key)) {
    return null
  }
  return {
    lead_source:
      data.lead_source || labelForAttributionKey(data.lead_source_key),
    lead_source_key: data.lead_source_key,
  }
}
