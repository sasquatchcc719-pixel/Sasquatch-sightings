import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'
import {
  loadSeasonality,
  projectAnnualRevenue,
  type RevenueProjection,
} from '@/lib/ops/revenue-projection'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export type CalendarPipelineMonth = {
  month: number // 1-12
  label: string
  // Completed work (actuals): all completed ops jobs + standalone commercial
  // revenue entries (manual entries not tied to an ops job). No double-count.
  completedRevenue: number
  completedJobCount: number
  // Upcoming booked value (invoice + lines when present, else quoted_total)
  // Covers: current month's not-yet-completed jobs + all future months
  bookedRevenue: number
  bookedJobCount: number
}

export type CalendarPipelineResponse = {
  year: number
  currentMonth: number // 1-12
  totalCompleted: number
  totalBooked: number
  months: CalendarPipelineMonth[]
  /** null when the projection could not be computed. */
  projection: RevenueProjection | null
}

/** Pull the effective invoice amount off an appointment's joined invoice/lines. */
function apptAmount(appt: unknown): number {
  const a = appt as {
    kind?: string | null
    quoted_total?: number
    ops_invoices?: unknown
  }
  const inv = Array.isArray(a.ops_invoices) ? a.ops_invoices[0] : a.ops_invoices
  const lineItems = inv
    ? Array.isArray(
        (inv as { ops_invoice_line_items?: unknown }).ops_invoice_line_items,
      )
      ? (inv as { ops_invoice_line_items: { line_total?: number }[] })
          .ops_invoice_line_items
      : []
    : []
  return effectiveInvoiceAmount({
    invoiceTotal: Number((inv as { total?: number })?.total || 0),
    invoiceLineItems: lineItems,
    quotedTotal: Number(a.quoted_total ?? 0),
    kind: a.kind,
  })
}

export async function GET() {
  try {
    const access = await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const now = new Date()
    const year = now.getFullYear()
    const currentMonth = now.getMonth() + 1 // 1-indexed
    const today = now.toISOString().slice(0, 10)
    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`

    const apptSelect = `
      appointment_date,
      status,
      kind,
      quoted_total,
      ops_invoices (
        total,
        ops_invoice_line_items ( line_total )
      )
    `

    // Booked (scheduled, not-yet-done): current-month upcoming + all future.
    const { data: booked, error: bookedErr } = await supabase
      .from('ops_appointments')
      .select(apptSelect)
      .gte('appointment_date', yearStart)
      .lte('appointment_date', yearEnd)
      .not('status', 'eq', 'cancelled')
      .not('status', 'eq', 'completed')
      .order('appointment_date', { ascending: true })
    if (bookedErr) throw bookedErr

    // Completed (actuals): every completed ops job this year.
    const { data: completed, error: completedErr } = await supabase
      .from('ops_appointments')
      .select(apptSelect)
      .gte('appointment_date', yearStart)
      .lte('appointment_date', yearEnd)
      .eq('status', 'completed')
    if (completedErr) throw completedErr

    // Standalone commercial revenue (manual entries NOT tied to an ops job),
    // e.g. recurring commercial work and pre-ops history. Linked entries are
    // skipped here because their ops job is already counted above.
    const { data: standalone, error: standaloneErr } = await supabase
      .from('revenue_entries')
      .select('invoice_amount, entry_date')
      .eq('user_id', access.id)
      .is('ops_invoice_id', null)
      .is('ops_appointment_id', null)
      .gte('entry_date', yearStart)
      .lte('entry_date', yearEnd)
    if (standaloneErr) throw standaloneErr

    // Pre-ops history: jobs from the prior software (e.g. Jan–Mar, before
    // Operations existed). Only applied to months with NO completed ops jobs,
    // so ops-tracked months never double-count. Linked jobs are excluded since
    // their ops appointment is already counted.
    const { data: legacyJobs, error: legacyErr } = await supabase
      .from('jobs')
      .select('invoice_amount, created_at')
      .not('invoice_amount', 'is', null)
      .is('ops_invoice_id', null)
      .gte('created_at', `${yearStart}T00:00:00`)
      .lte('created_at', `${yearEnd}T23:59:59`)
    if (legacyErr) throw legacyErr

    const buckets: CalendarPipelineMonth[] = Array.from(
      { length: 12 },
      (_, i) => ({
        month: i + 1,
        label: MONTH_NAMES[i],
        completedRevenue: 0,
        completedJobCount: 0,
        bookedRevenue: 0,
        bookedJobCount: 0,
      }),
    )

    // Completed ops jobs → bucket by appointment month.
    const opsCompletedCount = new Array(12).fill(0)
    for (const appt of completed ?? []) {
      const m = new Date(appt.appointment_date + 'T12:00:00').getMonth()
      buckets[m].completedRevenue += apptAmount(appt)
      buckets[m].completedJobCount += 1
      opsCompletedCount[m] += 1
    }

    // Standalone commercial entries → bucket by entry month.
    for (const row of standalone ?? []) {
      const m = new Date(row.entry_date + 'T12:00:00').getMonth()
      buckets[m].completedRevenue += Number(row.invoice_amount || 0)
      buckets[m].completedJobCount += 1
    }

    // Legacy jobs fill ONLY months Operations doesn't cover (no completed ops
    // jobs that month) — i.e. the pre-switch period. Bucketed by Mountain-time
    // month to match how those numbers were originally recorded.
    const denverMonth = (iso: string) =>
      Number(
        new Date(iso).toLocaleString('en-US', {
          timeZone: 'America/Denver',
          month: 'numeric',
        }),
      ) - 1
    for (const job of legacyJobs ?? []) {
      const m = denverMonth(job.created_at)
      if (opsCompletedCount[m] > 0) continue
      buckets[m].completedRevenue += Number(job.invoice_amount || 0)
      buckets[m].completedJobCount += 1
    }

    // Booked jobs → current-month upcoming + future months only.
    for (const appt of booked ?? []) {
      const apptMonth =
        new Date(appt.appointment_date + 'T12:00:00').getMonth() + 1
      const isCurrentMonthUpcoming =
        apptMonth === currentMonth && appt.appointment_date > today
      const isFuture = apptMonth > currentMonth
      if (!isCurrentMonthUpcoming && !isFuture) continue

      const bucket = buckets[apptMonth - 1]
      bucket.bookedRevenue += apptAmount(appt)
      bucket.bookedJobCount += 1
    }

    const totalCompleted = buckets.reduce((s, b) => s + b.completedRevenue, 0)
    const totalBooked = buckets.reduce((s, b) => s + b.bookedRevenue, 0)

    // Year-end projection from the same deduped monthly numbers, using real
    // seasonality from QuickBooks history and the recent (current-staffing)
    // run rate rather than a flat year-to-date average.
    let projection: RevenueProjection | null = null
    try {
      const { seasonality, years } = await loadSeasonality(supabase, {
        currentYear: year,
      })
      projection = projectAnnualRevenue({
        monthlyCompleted: buckets.map((b) => b.completedRevenue),
        monthlyBooked: buckets.map((b) => b.bookedRevenue),
        seasonality,
        seasonalityYears: years,
        today,
      })
    } catch (projErr) {
      // Never let the projection break the pipeline view.
      console.error('[calendar-pipeline] projection failed', projErr)
    }

    return NextResponse.json({
      year,
      currentMonth,
      totalCompleted,
      totalBooked,
      months: buckets,
      projection,
    } satisfies CalendarPipelineResponse)
  } catch (error) {
    console.error('[calendar-pipeline][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load calendar pipeline' },
      { status: 500 },
    )
  }
}
