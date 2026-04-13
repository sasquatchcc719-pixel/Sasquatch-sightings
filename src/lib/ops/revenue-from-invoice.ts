import type { SupabaseClient } from '@supabase/supabase-js'

function computeOnsiteHoursFromTimes(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number {
  if (!startTime || !endTime) return 0
  const [sh, sm] = String(startTime).split(':').map(Number)
  const [eh, em] = String(endTime).split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return 0
  return parseFloat((mins / 60).toFixed(2))
}

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
      ops_appointments (
        id,
        appointment_date,
        start_time,
        end_time,
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

  const invoiceTotal = Number(invoice.total || 0)
  const hoursWorked = computeOnsiteHoursFromTimes(
    appointment.start_time,
    appointment.end_time,
  )

  const description = lineItemNames.filter(Boolean).join(', ') || 'Ops job'

  const { data: inserted, error: insertError } = await supabase
    .from('revenue_entries')
    .insert({
      user_id: userId,
      entry_date:
        appointment.appointment_date || new Date().toISOString().split('T')[0],
      description,
      invoice_amount: invoiceTotal,
      hours_worked: hoursWorked,
      drive_minutes: driveMinutes,
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
