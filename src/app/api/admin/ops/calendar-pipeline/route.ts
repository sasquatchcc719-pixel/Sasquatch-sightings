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
  // Upcoming booked value from ops_appointments (quoted_total)
  // Covers: current month's not-yet-completed jobs + all future months
  bookedRevenue: number
  bookedJobCount: number
}

export type CalendarPipelineResponse = {
  year: number
  currentMonth: number // 1-12
  totalBooked: number
  months: CalendarPipelineMonth[]
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const now = new Date()
    const year = now.getFullYear()
    const currentMonth = now.getMonth() + 1 // 1-indexed
    const today = now.toISOString().slice(0, 10)
    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`

    // Only fetch appointments that are not yet done — current month upcoming + all future
    const { data: appointments, error } = await supabase
      .from('ops_appointments')
      .select('appointment_date, status, quoted_total')
      .gte('appointment_date', yearStart)
      .lte('appointment_date', yearEnd)
      .not('status', 'eq', 'cancelled')
      .not('status', 'eq', 'completed')
      .order('appointment_date', { ascending: true })

    if (error) throw error

    const buckets: CalendarPipelineMonth[] = Array.from(
      { length: 12 },
      (_, i) => ({
        month: i + 1,
        label: MONTH_NAMES[i],
        bookedRevenue: 0,
        bookedJobCount: 0,
      }),
    )

    for (const appt of appointments ?? []) {
      // Only include current month's upcoming dates and all future months
      const apptMonth =
        new Date(appt.appointment_date + 'T12:00:00').getMonth() + 1
      const isCurrentMonthUpcoming =
        apptMonth === currentMonth && appt.appointment_date > today
      const isFuture = apptMonth > currentMonth

      if (!isCurrentMonthUpcoming && !isFuture) continue

      const bucket = buckets[apptMonth - 1]
      bucket.bookedRevenue += Number(appt.quoted_total ?? 0)
      bucket.bookedJobCount += 1
    }

    const totalBooked = buckets.reduce((s, b) => s + b.bookedRevenue, 0)

    return NextResponse.json({
      year,
      currentMonth,
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
