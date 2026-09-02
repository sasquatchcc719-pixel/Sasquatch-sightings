import type { SupabaseClient } from '@supabase/supabase-js'
import {
  effectiveInvoiceAmount,
  utilizationHoursFromAppointment,
} from '@/lib/ops/utilization-metrics'

export type RecordRevenueFromOpsInvoiceResult =
  | { ok: true; skipped: true; reason: 'already_recorded' }
  | { ok: true; skipped: false; entry_id: string }
  | { ok: false; error: string }

/**
 * Inserts a revenue_entries row for an ops invoice (stats without publishing a job post).
 * Idempotent: skips if ops_invoice_id already present.
 */
export async function recordRevenueFromOpsInvoice(
  supabase: SupabaseClient,
  params: {
    invoiceId: string
    userId: string
    driveMinutes?: number | null
    /**
     * Hours to record instead of the invoice appointment's own.
     *
     * For a water loss the invoice covers every visit on the project, so the
     * closing visit's own hours understate the job badly. See
     * restorationLaborHours — and note it is paired with a coverage branch in
     * loadUtilizationSupplementRows, without which these hours are counted
     * twice.
     */
    hoursWorkedOverride?: number | null
  },
): Promise<RecordRevenueFromOpsInvoiceResult> {
  const { invoiceId, userId } = params
  const driveMinutes =
    params.driveMinutes != null && Number.isFinite(params.driveMinutes)
      ? Math.max(0, Math.round(params.driveMinutes))
      : null

  const { data: existing } = await supabase
    .from('revenue_entries')
    .select('id')
    .eq('ops_invoice_id', invoiceId)
    .maybeSingle()

  if (existing?.id) {
    return { ok: true, skipped: true, reason: 'already_recorded' }
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .select(
      `
      id,
      total,
      ops_invoice_line_items (
        line_total
      ),
      ops_appointments (
        id,
        appointment_date,
        start_time,
        end_time,
        quoted_total,
        on_my_way_at,
        completed_at,
        ops_appointment_line_items ( name_snapshot )
      )
    `,
    )
    .eq('id', invoiceId)
    .single()

  if (invoiceError || !invoice) {
    return { ok: false, error: 'Invoice not found' }
  }

  const appointment = Array.isArray(invoice.ops_appointments)
    ? invoice.ops_appointments[0]
    : invoice.ops_appointments
  if (!appointment) {
    return { ok: false, error: 'No appointment linked to this invoice' }
  }

  const rawLineItems = Array.isArray(appointment.ops_appointment_line_items)
    ? appointment.ops_appointment_line_items
    : appointment.ops_appointment_line_items
      ? [appointment.ops_appointment_line_items]
      : []
  const lineItemNames = rawLineItems.map((li: { name_snapshot?: string }) =>
    String(li.name_snapshot ?? ''),
  )

  const invLines = Array.isArray(invoice.ops_invoice_line_items)
    ? invoice.ops_invoice_line_items
    : invoice.ops_invoice_line_items
      ? [invoice.ops_invoice_line_items]
      : []

  const invoiceTotal = effectiveInvoiceAmount({
    invoiceTotal: Number(invoice.total || 0),
    invoiceLineItems: invLines,
    quotedTotal: Number(
      (appointment as { quoted_total?: number }).quoted_total || 0,
    ),
  })

  const override = params.hoursWorkedOverride
  const hoursWorked =
    override != null && Number.isFinite(override) && override > 0
      ? Math.round(override * 100) / 100
      : utilizationHoursFromAppointment({
          on_my_way_at: (appointment as { on_my_way_at?: string | null })
            .on_my_way_at,
          completed_at: (appointment as { completed_at?: string | null })
            .completed_at,
          start_time: appointment.start_time,
          end_time: appointment.end_time,
        })

  const description = lineItemNames.filter(Boolean).join(', ') || 'Ops job'

  const usedWallClock = Boolean(
    (appointment as { on_my_way_at?: string | null }).on_my_way_at &&
    (appointment as { completed_at?: string | null }).completed_at,
  )

  const { data: inserted, error: insertError } = await supabase
    .from('revenue_entries')
    .insert({
      user_id: userId,
      entry_date:
        appointment.appointment_date || new Date().toISOString().split('T')[0],
      description,
      invoice_amount: invoiceTotal,
      hours_worked: hoursWorked,
      drive_minutes: usedWallClock ? null : driveMinutes,
      ops_invoice_id: invoiceId,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[recordRevenueFromOpsInvoice]', insertError)
    return { ok: false, error: 'Failed to record stats' }
  }

  if (!inserted?.id) {
    return { ok: false, error: 'Failed to record stats' }
  }

  return { ok: true, skipped: false, entry_id: inserted.id }
}
