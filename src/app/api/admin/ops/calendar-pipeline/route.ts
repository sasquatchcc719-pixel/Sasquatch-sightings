import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

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
  // Past months: actual collected revenue (revenue_entries + jobs)
  actualRevenue: number
  actualJobCount: number
  // Current month: both collected so far + remaining booked
  collectedThisMonth: number // orange bar — done work
  bookedThisMonth: number // blue bar — upcoming appointments
  // Future months: booked value from ops_appointments
  bookedRevenue: number
  bookedJobCount: number
  // Which state is this month in
  state: 'past' | 'current' | 'future'
}

export type CalendarPipelineResponse = {
  year: number
  currentMonth: number // 1-12
  // Rolled-up summary
  totalActual: number // all actual revenue earned YTD
  totalBooked: number // all future booked value
  totalOnCalendar: number // combined full-year view
  months: CalendarPipelineMonth[]
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

    // ── 1. Historical revenue: revenue_entries + jobs ────────────────────
    const [{ data: entries }, { data: jobs }] = await Promise.all([
      supabase
        .from('revenue_entries')
        .select('entry_date, invoice_amount')
        .eq('user_id', access.id)
        .gte('entry_date', yearStart)
        .lte('entry_date', yearEnd),
      supabase
        .from('jobs')
        .select('created_at, invoice_amount')
        .gte('created_at', yearStart + 'T00:00:00Z')
        .lte('created_at', yearEnd + 'T23:59:59Z')
        .not('invoice_amount', 'is', null),
    ])

    // Bucket actual revenue by month (0-indexed internally)
    const actualByMonth: { revenue: number; count: number }[] = Array.from(
      { length: 12 },
      () => ({ revenue: 0, count: 0 }),
    )

    for (const e of entries ?? []) {
      if (!e.entry_date) continue
      const m = new Date(e.entry_date + 'T12:00:00').getMonth()
      actualByMonth[m].revenue += Number(e.invoice_amount ?? 0)
      actualByMonth[m].count += 1
    }
    for (const j of jobs ?? []) {
      if (!j.created_at) continue
      const m = new Date(j.created_at).getMonth()
      actualByMonth[m].revenue += Number(j.invoice_amount ?? 0)
      actualByMonth[m].count += 1
    }

    // ── 2. Ops appointments: booked value for current + future months ───
    const { data: appointments, error } = await supabase
      .from('ops_appointments')
      .select('appointment_date, status, quoted_total')
      .gte('appointment_date', yearStart)
      .lte('appointment_date', yearEnd)
      .not('status', 'eq', 'cancelled')
      .order('appointment_date', { ascending: true })

    if (error) throw error

    // For current month: split into completed-so-far vs still upcoming
    // For future months: sum of all quoted_total
    const opsCollectedCurrent = { revenue: 0 }
    const opsBookedCurrent = { revenue: 0 }
    const opsByMonth: { revenue: number; count: number }[] = Array.from(
      { length: 12 },
      () => ({ revenue: 0, count: 0 }),
    )

    for (const appt of appointments ?? []) {
      const m = new Date(appt.appointment_date + 'T12:00:00').getMonth() // 0-indexed
      const month1 = m + 1 // 1-indexed
      const quoted = Number(appt.quoted_total ?? 0)

      if (month1 === currentMonth) {
        // Split current month
        if (appt.appointment_date <= today && appt.status === 'completed') {
          opsCollectedCurrent.revenue += quoted
        } else if (
          appt.appointment_date > today ||
          appt.status !== 'completed'
        ) {
          opsBookedCurrent.revenue += quoted
        }
      } else if (month1 > currentMonth) {
        // Future months
        opsByMonth[m].revenue += quoted
        opsByMonth[m].count += 1
      }
      // Past months: don't use ops data — actual revenue_entries is more accurate
    }

    // ── 3. Assemble buckets ──────────────────────────────────────────────
    const months: CalendarPipelineMonth[] = MONTH_NAMES.map((label, i) => {
      const month = i + 1

      if (month < currentMonth) {
        return {
          month,
          label,
          state: 'past',
          actualRevenue: actualByMonth[i].revenue,
          actualJobCount: actualByMonth[i].count,
          collectedThisMonth: 0,
          bookedThisMonth: 0,
          bookedRevenue: 0,
          bookedJobCount: 0,
        }
      }

      if (month === currentMonth) {
        return {
          month,
          label,
          state: 'current',
          actualRevenue: 0,
          actualJobCount: 0,
          collectedThisMonth: opsCollectedCurrent.revenue,
          bookedThisMonth: opsBookedCurrent.revenue,
          bookedRevenue: 0,
          bookedJobCount: 0,
        }
      }

      // future
      return {
        month,
        label,
        state: 'future',
        actualRevenue: 0,
        actualJobCount: 0,
        collectedThisMonth: 0,
        bookedThisMonth: 0,
        bookedRevenue: opsByMonth[i].revenue,
        bookedJobCount: opsByMonth[i].count,
      }
    })

    const totalActual = months.reduce(
      (s, m) => s + m.actualRevenue + m.collectedThisMonth,
      0,
    )
    const totalBooked = months.reduce(
      (s, m) => s + m.bookedThisMonth + m.bookedRevenue,
      0,
    )
    const totalOnCalendar = totalActual + totalBooked

    return NextResponse.json({
      year,
      currentMonth,
      totalActual,
      totalBooked,
      totalOnCalendar,
      months,
    } satisfies CalendarPipelineResponse)
  } catch (error) {
    console.error('[calendar-pipeline][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load calendar pipeline' },
      { status: 500 },
    )
  }
}
