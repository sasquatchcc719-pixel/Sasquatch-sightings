/** Max hours for a single job in one stretch (sanity cap for bad clocks). */
const MAX_SINGLE_JOB_HOURS = 18

function slotHours(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number {
  if (!startTime || !endTime) return 0
  const [sh, sm] = String(startTime).slice(0, 5).split(':').map(Number)
  const [eh, em] = String(endTime).slice(0, 5).split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return 0
  return Number((mins / 60).toFixed(2))
}

/**
 * Prefer real duration from first "On My Way" through completion; otherwise scheduled slot.
 */
export function utilizationHoursFromAppointment(appt: {
  on_my_way_at?: string | null
  completed_at?: string | null
  start_time?: string | null
  end_time?: string | null
}): number {
  const oa = appt.on_my_way_at
  const ca = appt.completed_at
  if (oa && ca) {
    const ms = new Date(ca).getTime() - new Date(oa).getTime()
    const hours = ms / 3600000
    if (ms > 0 && hours <= MAX_SINGLE_JOB_HOURS) {
      return Math.round(hours * 100) / 100
    }
  }
  return slotHours(appt.start_time, appt.end_time)
}

type LineRow = { line_total?: number | null }

/**
 * Single source of truth for job value in reporting.
 *
 * Priority (first match wins — no max-with-stale-fields):
 *   1. Invoice header total (ops_invoices.total) — the real source of truth once
 *      an invoice exists; this is what the customer was charged.
 *   2. Invoice line item sum — only if invoice total is 0/missing.
 *   3. Quote total — only if neither invoice nor lines exist (pre-invoice jobs).
 *
 * Restoration is special: a water loss bills once on the closing visit.
 * Mitigation/monitor `quoted_total` values are calendar estimates for the
 * project, not separate invoices. Falling back to them double-counts the
 * job (Benns: ~$3.9k quote on mitigation + ~$4k closing invoice = ~$7.9k).
 */
export function effectiveInvoiceAmount(params: {
  invoiceTotal: number
  invoiceLineItems?: LineRow[] | null
  quotedTotal?: number | null
  kind?: string | null
}): number {
  const inv = Number(params.invoiceTotal || 0)
  if (inv > 0) return inv

  const lineSum = (params.invoiceLineItems || []).reduce(
    (s, li) => s + Number(li.line_total || 0),
    0,
  )
  if (lineSum > 0) return lineSum

  if (params.kind === 'restoration') return 0

  return Math.max(Number(params.quotedTotal || 0), 0)
}

/** Calendar / dashboard: same priority as stats/utilization. */
export function appointmentDisplayRevenue(appt: {
  kind?: string | null
  quoted_total?: number | null
  ops_invoices?:
    | {
        total?: number | null
        ops_invoice_line_items?: LineRow[] | null
      }
    | Array<{
        total?: number | null
        ops_invoice_line_items?: LineRow[] | null
      }>
    | null
  ops_appointment_line_items?: LineRow[] | null
}): number {
  const inv = Array.isArray(appt.ops_invoices)
    ? appt.ops_invoices[0]
    : appt.ops_invoices
  // Prefer invoice line items (the real invoice); fall back to appointment
  // line items only if invoice line items aren't present.
  const invoiceLineItems =
    (inv?.ops_invoice_line_items && inv.ops_invoice_line_items.length
      ? inv.ops_invoice_line_items
      : appt.ops_appointment_line_items) || null
  return effectiveInvoiceAmount({
    invoiceTotal: Number(inv?.total || 0),
    invoiceLineItems,
    quotedTotal: appt.quoted_total,
    kind: appt.kind,
  })
}

/**
 * Revenue contribution for calendar summaries. Estimate appointments may show
 * their quote on the card, but the proposed work is not booked revenue yet.
 */
export function appointmentScheduleRevenue(
  appt: Parameters<typeof appointmentDisplayRevenue>[0],
): number {
  if (appt.kind === 'estimate') return 0
  return appointmentDisplayRevenue(appt)
}
