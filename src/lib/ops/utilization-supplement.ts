import type { SupabaseClient } from '@supabase/supabase-js'
import {
  effectiveInvoiceAmount,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'

export type SupplementRow = {
  invoice_amount: number
  hours_worked: number
  date: string
}

/**
 * Completed ops jobs whose revenue/hours are not already represented by
 * revenue_entries (stats-only) or published jobs rows.
 *
 * `coverageUserId` limits which revenue_entries count as "already covered":
 * pass a user id for that user's stats view (their own entries cover jobs),
 * or omit it to treat every user's entries as coverage — the business-wide
 * view, where techs' auto-created entries also count.
 */
export async function loadUtilizationSupplementRows(
  supabase: SupabaseClient,
  options?: { coverageUserId?: string },
): Promise<SupplementRow[]> {
  let entriesQuery = supabase
    .from('revenue_entries')
    .select('ops_invoice_id, ops_appointment_id')
  if (options?.coverageUserId) {
    entriesQuery = entriesQuery.eq('user_id', options.coverageUserId)
  }
  const { data: entryRows } = await entriesQuery

  const coveredInvoices = new Set<string>()
  const coveredAppointments = new Set<string>()
  for (const row of entryRows || []) {
    if (row.ops_invoice_id) coveredInvoices.add(row.ops_invoice_id)
    if (row.ops_appointment_id) coveredAppointments.add(row.ops_appointment_id)
  }

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('ops_invoice_id')
    .not('ops_invoice_id', 'is', null)

  for (const row of jobRows || []) {
    if (row.ops_invoice_id) coveredInvoices.add(row.ops_invoice_id)
  }

  const { data: completedAppts, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      appointment_date,
      start_time,
      end_time,
      quoted_total,
      on_my_way_at,
      completed_at,
      ops_appointment_line_items (
        line_total
      ),
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

  const rows: SupplementRow[] = []

  for (const appt of completedAppts || []) {
    const inv = Array.isArray(appt.ops_invoices)
      ? appt.ops_invoices[0]
      : appt.ops_invoices
    if (!appt.appointment_date) continue
    if (inv?.id && coveredInvoices.has(inv.id)) continue
    if (!inv?.id && coveredAppointments.has(appt.id)) continue

    const appointmentLineItems = Array.isArray(appt.ops_appointment_line_items)
      ? appt.ops_appointment_line_items
      : appt.ops_appointment_line_items
        ? [appt.ops_appointment_line_items]
        : []
    const invoiceLineItems = Array.isArray(inv?.ops_invoice_line_items)
      ? inv.ops_invoice_line_items
      : inv?.ops_invoice_line_items
        ? [inv.ops_invoice_line_items]
        : []

    const amt = effectiveInvoiceAmount({
      invoiceTotal: Number(inv?.total || 0),
      invoiceLineItems:
        invoiceLineItems.length > 0 ? invoiceLineItems : appointmentLineItems,
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

  return rows
}
