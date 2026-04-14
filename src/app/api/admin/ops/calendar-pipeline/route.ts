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
  label: string // "January" etc.
  total: number // sum of quoted_total (all non-cancelled)
  jobCount: number
  completedTotal: number
  upcomingTotal: number
  paidTotal: number
  paidCount: number
}

export type CalendarPipelineResponse = {
  year: number
  total: number
  completedTotal: number
  upcomingTotal: number
  paidTotal: number
  jobCount: number
  months: CalendarPipelineMonth[]
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'dispatcher'])
    const supabase = createAdminClient()

    const year = new Date().getFullYear()
    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`
    const today = new Date().toISOString().slice(0, 10)

    const { data: appointments, error } = await supabase
      .from('ops_appointments')
      .select(
        `
        id,
        appointment_date,
        status,
        quoted_total,
        ops_invoices (
          total,
          payment_status
        )
      `,
      )
      .gte('appointment_date', yearStart)
      .lte('appointment_date', yearEnd)
      .not('status', 'eq', 'cancelled')
      .order('appointment_date', { ascending: true })

    if (error) throw error

    // Build 12 empty buckets
    const buckets: CalendarPipelineMonth[] = Array.from(
      { length: 12 },
      (_, i) => ({
        month: i + 1,
        label: MONTH_NAMES[i],
        total: 0,
        jobCount: 0,
        completedTotal: 0,
        upcomingTotal: 0,
        paidTotal: 0,
        paidCount: 0,
      }),
    )

    for (const appt of appointments ?? []) {
      const month = new Date(appt.appointment_date + 'T12:00:00').getMonth() // 0-indexed
      const bucket = buckets[month]
      const quoted = Number(appt.quoted_total ?? 0)
      const isCompleted = appt.status === 'completed'
      const isUpcoming = appt.appointment_date > today

      // Invoice data (may be array or object due to Supabase join)
      const rawInv = appt.ops_invoices
      const invoices = Array.isArray(rawInv) ? rawInv : rawInv ? [rawInv] : []
      const isPaid = invoices.some(
        (inv: { payment_status?: string }) => inv.payment_status === 'paid',
      )
      const invoiceTotal = invoices.reduce(
        (s: number, inv: { total?: number }) => s + Number(inv.total ?? 0),
        0,
      )

      bucket.total += quoted
      bucket.jobCount += 1
      if (isCompleted) bucket.completedTotal += quoted
      if (isUpcoming) bucket.upcomingTotal += quoted
      if (isPaid) {
        bucket.paidTotal += invoiceTotal || quoted
        bucket.paidCount += 1
      }
    }

    // Aggregate totals
    const total = buckets.reduce((s, b) => s + b.total, 0)
    const completedTotal = buckets.reduce((s, b) => s + b.completedTotal, 0)
    const upcomingTotal = buckets.reduce((s, b) => s + b.upcomingTotal, 0)
    const paidTotal = buckets.reduce((s, b) => s + b.paidTotal, 0)
    const jobCount = buckets.reduce((s, b) => s + b.jobCount, 0)

    const response: CalendarPipelineResponse = {
      year,
      total,
      completedTotal,
      upcomingTotal,
      paidTotal,
      jobCount,
      months: buckets,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[calendar-pipeline][GET] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load calendar pipeline' },
      { status: 500 },
    )
  }
}
