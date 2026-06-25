import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { effectiveInvoiceAmount } from '@/lib/ops/utilization-metrics'

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
}

/** Pull the effective invoice amount off an appointment's joined invoice/lines. */
function apptAmount(appt: unknown): number {
  const a = appt as {
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
    for (const appt of completed ?? []) {
      const m = new Date(appt.appointment_date + 'T12:00:00').getMonth()
      buckets[m].completedRevenue += apptAmount(appt)
      buckets[m].completedJobCount += 1
    }

    // Standalone commercial entries → bucket by entry month.
    for (const row of standalone ?? []) {
      const m = new Date(row.entry_date + 'T12:00:00').getMonth()
      buckets[m].completedRevenue += Number(row.invoice_amount || 0)
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

    return NextResponse.json({
      year,
      currentMonth,
      totalCompleted,
      totalBooked,
      months: buckets,
    } satisfies CalendarPipelineResponse)
  } catch (error) {
    console.error('[calendar-pipeline][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load calendar pipeline' },
      { status: 500 },
    )
  }
}
