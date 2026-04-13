import { NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import {
  effectiveInvoiceAmount,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'

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
        quoted_total,
        on_my_way_at,
        completed_at,
        ops_invoices (
          id,
          total,
          ops_invoice_line_items (
            line_total
          )
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

      const lineItems = Array.isArray(inv.ops_invoice_line_items)
        ? inv.ops_invoice_line_items
        : inv.ops_invoice_line_items
          ? [inv.ops_invoice_line_items]
          : []

      const amt = effectiveInvoiceAmount({
        invoiceTotal: Number(inv.total || 0),
        invoiceLineItems: lineItems,
        quotedTotal: Number(
          (appt as { quoted_total?: number }).quoted_total || 0,
        ),
      })

      const hw = utilizationHoursFromAppointment({
        on_my_way_at: (appt as { on_my_way_at?: string | null }).on_my_way_at,
        completed_at: (appt as { completed_at?: string | null }).completed_at,
        start_time: appt.start_time,
        end_time: appt.end_time,
      })

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
