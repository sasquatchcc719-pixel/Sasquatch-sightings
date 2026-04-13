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

export function effectiveInvoiceAmount(params: {
  invoiceTotal: number
  invoiceLineItems?: LineRow[] | null
  quotedTotal?: number | null
}): number {
  const lineSum = (params.invoiceLineItems || []).reduce(
    (s, li) => s + Number(li.line_total || 0),
    0,
  )
  return Math.max(
    Number(params.invoiceTotal || 0),
    lineSum,
    Number(params.quotedTotal || 0),
    0,
  )
}
