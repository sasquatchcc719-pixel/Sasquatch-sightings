import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'

function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number {
  if (!start || !end) return 0
  const [sh, sm] = String(start).slice(0, 5).split(':').map(Number)
  const [eh, em] = String(end).slice(0, 5).split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  return mins > 0 ? Number((mins / 60).toFixed(2)) : 0
}

/**
 * Completed ops jobs whose revenue/hours are not already represented by
 * revenue_entries (stats-only) or published jobs rows — so utilization matches Operations.
 */
export async function GET() {
  try {
    const access = await requireAnyRole([
      'admin',
      'owner',
      'dispatcher',
      'tech',
      'marketing',
    ])
    const supabase = createAdminClient()

    const { data: entryRows } = await supabase
      .from('revenue_entries')
      .select('ops_invoice_id')
      .eq('user_id', access.id)
      .not('ops_invoice_id', 'is', null)

    const covered = new Set<string>()
    for (const row of entryRows || []) {
      if (row.ops_invoice_id) covered.add(row.ops_invoice_id)
    }

    const { data: jobRows } = await supabase
      .from('jobs')
      .select('ops_invoice_id')
      .not('ops_invoice_id', 'is', null)

    for (const row of jobRows || []) {
      if (row.ops_invoice_id) covered.add(row.ops_invoice_id)
    }

    const { data: completedAppts, error } = await supabase
      .from('ops_appointments')
      .select(
        `
        appointment_date,
        start_time,
        end_time,
        ops_invoices (
          id,
          total
        )
      `,
      )
      .eq('status', 'completed')

    if (error) throw error

    const rows: {
      invoice_amount: number
      hours_worked: number
      date: string
    }[] = []

    for (const appt of completedAppts || []) {
      const inv = Array.isArray(appt.ops_invoices)
        ? appt.ops_invoices[0]
        : appt.ops_invoices
      if (!inv?.id || !appt.appointment_date) continue
      if (covered.has(inv.id)) continue

      const amt = Number(inv.total || 0)
      const hw = hoursBetween(appt.start_time, appt.end_time)
      if (amt <= 0 && hw <= 0) continue

      rows.push({
        invoice_amount: amt,
        hours_worked: hw,
        date: `${appt.appointment_date}T12:00:00.000Z`,
      })
    }

    return NextResponse.json({ rows })
  } catch (err) {
    console.error('[utilization-supplement]', err)
    const message =
      err instanceof Error ? err.message : 'Failed to load supplement'
    if (message === 'Not authorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
