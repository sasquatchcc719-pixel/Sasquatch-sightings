import type { SupabaseClient } from '@supabase/supabase-js'
import { getQuickBooksSyncStatus } from '@/lib/quickbooks'

/**
 * Restoration project lifecycle.
 *
 * A water loss is a mitigation day plus monitor days. Individual visits never
 * invoice — the customer is billed once, when the project closes from whichever
 * monitor day reaches dry standard. Day 1 has no close action at all, because
 * nothing is ever dry on day 1.
 */

export const DEFAULT_MONITOR_VISITS = 3
export const MONITOR_VISIT_MINUTES = 60

export type ProjectAppointmentLine = {
  appointment_id: string
  name_snapshot: string
  quantity: number
  unit_price: number
  line_total: number
  service_catalog_item_id?: string | null
}

export type ProjectEquipmentLine = {
  catalog_code: string
  description: string
  unit_price: number
  units: number
  unit_days: number
  line_total: number
}

export type BuiltInvoiceLine = {
  description: string
  quantity: number
  unit_price: number
  line_total: number
  appointment_line_item_id: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Assemble one invoice from every visit's line items plus the equipment days
 * derived from the map. Pure so the arithmetic is testable without a database.
 *
 * Equipment is billed as unit-days: six air movers running three days is a
 * quantity of 18, which is the mental arithmetic this replaces.
 */
export function buildProjectInvoiceLines(input: {
  appointmentLines: ProjectAppointmentLine[]
  equipmentLines: ProjectEquipmentLine[]
  lineItemIdByIndex?: Array<string | null>
}): { lines: BuiltInvoiceLine[]; subtotal: number } {
  const lines: BuiltInvoiceLine[] = []

  for (const l of input.appointmentLines) {
    lines.push({
      description: l.name_snapshot,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      line_total: round2(Number(l.line_total)),
      appointment_line_item_id: null,
    })
  }

  for (const e of input.equipmentLines) {
    if (e.unit_days <= 0) continue
    lines.push({
      // Quantity is unit-days, so the label states the unit count rather than
      // an average days-per-unit, which would be misleading once some units
      // have been pulled earlier than others.
      description:
        e.units > 1 ? `${e.description} (${e.units} units)` : e.description,
      quantity: e.unit_days,
      unit_price: Number(e.unit_price),
      line_total: round2(e.unit_days * Number(e.unit_price)),
      appointment_line_item_id: null,
    })
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.line_total, 0))
  return { lines, subtotal }
}

/**
 * What the customer actually owes at the close.
 *
 * Three numbers land on one invoice and their order matters. The deposit was
 * taken on day one against a total nobody knew yet; the deductible split is a
 * discount off our own work; and the bill is what is left. Pure, because this
 * is the arithmetic that decides what a customer is asked for.
 */
export function settleProjectInvoice(input: {
  subtotal: number
  creditRequested: number
  depositCents: number
}): {
  discount: number
  total: number
  balanceCents: number
  refundDueCents: number
  paymentStatus: 'unpaid' | 'partial' | 'paid'
} {
  // Never credit more than the job is worth: a negative invoice total is
  // something QuickBooks will accept and nobody wants to explain.
  const discount = Math.min(
    input.subtotal,
    Math.max(0, Number(input.creditRequested) || 0),
  )
  const total = round2(input.subtotal - discount)
  const balanceCents = Math.round(total * 100) - input.depositCents

  return {
    discount,
    total,
    balanceCents,
    // A $1,000 deposit plus a $500 credit can exceed a small loss. That is
    // money owed BACK, and it has to be visible at the close rather than
    // discovered later as a negative balance nobody acted on.
    refundDueCents: balanceCents < 0 ? -balanceCents : 0,
    paymentStatus:
      input.depositCents <= 0
        ? 'unpaid'
        : balanceCents <= 0
          ? 'paid'
          : 'partial',
  }
}

export type CloseProjectResult =
  | { ok: false; error: string }
  | {
      ok: true
      invoiceId: string
      subtotal: number
      total: number
      depositCents: number
      balanceCents: number
      /** Deposit and deductible credit exceeded the bill: money owed back. */
      refundDueCents: number
      paymentStatus: 'unpaid' | 'partial' | 'paid'
      cancelledQueued: number
      cancelledAppointments: number
    }

/**
 * Close a project from a monitor visit that has reached dry standard.
 *
 * Assembles the single invoice, stops equipment accrual, cancels every visit
 * that is no longer needed (both queued and already on the calendar), and hands
 * the invoice to the normal ready -> QuickBooks path.
 */
export async function closeRestorationProject(
  supabase: SupabaseClient,
  params: {
    projectId: string
    closingAppointmentId: string
    userId: string
    dryStandardNotes?: string | null
  },
): Promise<CloseProjectResult> {
  const { projectId, closingAppointmentId, userId } = params
  const nowIso = new Date().toISOString()

  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id, status, invoice_id, closed_at, deductible, deductible_credit')
    .eq('id', projectId)
    .maybeSingle()

  if (!project) return { ok: false, error: 'project_not_found' }
  if (project.status === 'closed' || project.invoice_id) {
    return { ok: false, error: 'project_already_closed' }
  }

  const { data: visits } = await supabase
    .from('ops_appointments')
    .select('id, status, visit_type, appointment_date, end_time')
    .eq('restoration_project_id', projectId)

  const visitList = visits ?? []
  const closing = visitList.find((v) => v.id === closingAppointmentId)
  if (!closing) return { ok: false, error: 'closing_visit_not_in_project' }
  if (closing.visit_type === 'mitigation') {
    // Nothing is dry on day 1. Guarding here as well as in the UI so an API
    // caller cannot bill a job that has not been dried.
    return { ok: false, error: 'cannot_close_on_mitigation_day' }
  }

  const visitIds = visitList.map((v) => v.id)

  const { data: apptLines } = await supabase
    .from('ops_appointment_line_items')
    .select(
      'id, appointment_id, name_snapshot, quantity, unit_price, line_total',
    )
    .in('appointment_id', visitIds)

  // Stop equipment accrual at the close, then read the billing view.
  await supabase
    .from('restoration_equipment_placements')
    .update({ removed_at: nowIso })
    .eq('project_id', projectId)
    .is('removed_at', null)

  await supabase
    .from('restoration_projects')
    .update({ closed_at: nowIso, updated_at: nowIso })
    .eq('id', projectId)

  const { data: equipment } = await supabase
    .from('restoration_equipment_billing')
    .select(
      'catalog_code, description, unit_price, units, unit_days, line_total',
    )
    .eq('project_id', projectId)

  const { lines, subtotal } = buildProjectInvoiceLines({
    appointmentLines: (apptLines ?? []).map((l) => ({
      appointment_id: String(l.appointment_id),
      name_snapshot: String(l.name_snapshot),
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      line_total: Number(l.line_total),
    })),
    equipmentLines: (equipment ?? []).map((e) => ({
      catalog_code: String(e.catalog_code),
      description: String(e.description),
      unit_price: Number(e.unit_price),
      units: Number(e.units),
      unit_days: Number(e.unit_days),
      line_total: Number(e.line_total),
    })),
  })

  const lineIdByDescription = new Map(
    (apptLines ?? []).map((l) => [
      `${l.name_snapshot}|${l.line_total}`,
      String(l.id),
    ]),
  )

  const { data: invoice, error: invoiceError } = await supabase
    .from('ops_invoices')
    .insert({
      appointment_id: closingAppointmentId,
      status: 'ready',
      payment_status: 'unpaid',
      subtotal,
      // Splitting the deductible with the homeowner is routine on an insurance
      // job: they owe $1,000, and Charles discounts $500 of his own work so
      // they are not out of pocket for all of it. It rides the invoice's own
      // discount field, which QuickBooks already understands, rather than a
      // negative line item that would need its own QuickBooks item.
      discount_amount: Math.min(
        subtotal,
        Math.max(0, Number(project.deductible_credit ?? 0) || 0),
      ),
      total: round2(
        subtotal -
          Math.min(
            subtotal,
            Math.max(0, Number(project.deductible_credit ?? 0) || 0),
          ),
      ),
      sync_status: getQuickBooksSyncStatus(),
    })
    .select('id, total')
    .single()

  if (invoiceError || !invoice) {
    return {
      ok: false,
      error: invoiceError?.message ?? 'invoice_insert_failed',
    }
  }

  if (lines.length > 0) {
    const { error: linesError } = await supabase
      .from('ops_invoice_line_items')
      .insert(
        lines.map((l) => ({
          invoice_id: invoice.id,
          appointment_line_item_id:
            lineIdByDescription.get(`${l.description}|${l.line_total}`) ?? null,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: l.line_total,
        })),
      )
    if (linesError) return { ok: false, error: linesError.message }
  }

  // Any deposit already collected during mitigation follows the project onto
  // its invoice, so the balance due is the total minus what was taken on day 1.
  const { data: deposits } = await supabase
    .from('ops_payments')
    .select('id, amount_cents')
    .in('appointment_id', visitIds)
    .is('invoice_id', null)

  let depositCents = 0
  if (deposits && deposits.length > 0) {
    depositCents = deposits.reduce((sum, p) => sum + Number(p.amount_cents), 0)
    await supabase
      .from('ops_payments')
      .update({ invoice_id: invoice.id })
      .in(
        'id',
        deposits.map((d) => d.id),
      )
  } else {
    const { data: already } = await supabase
      .from('ops_payments')
      .select('amount_cents')
      .eq('invoice_id', invoice.id)
    depositCents = (already ?? []).reduce(
      (s, p) => s + Number(p.amount_cents),
      0,
    )
  }

  // Left at 'unpaid', a job already covered by its own deposit would go out
  // asking for the full amount a second time.
  const settlement = settleProjectInvoice({
    subtotal,
    creditRequested: Number(project.deductible_credit ?? 0) || 0,
    depositCents,
  })
  const { balanceCents, refundDueCents, paymentStatus } = settlement

  await supabase
    .from('ops_invoices')
    .update({
      payment_status: paymentStatus,
      ...(paymentStatus === 'paid' ? { status: 'paid' } : {}),
    })
    .eq('id', invoice.id)

  await supabase.from('ops_invoice_status_events').insert({
    invoice_id: invoice.id,
    from_status: 'draft',
    to_status: 'ready',
    changed_by_user_id: userId,
    notes: 'Restoration project closed — dry standard reached',
  })

  // Everything still outstanding is no longer needed.
  const { data: cancelledQueue } = await supabase
    .from('restoration_visit_queue')
    .update({
      status: 'cancelled',
      cancelled_reason: 'project closed — dry standard reached',
      updated_at: nowIso,
    })
    .eq('project_id', projectId)
    .eq('status', 'queued')
    .select('id')

  /**
   * A visit nobody tapped "finish" on is not the same as a visit that never
   * happened, and the close used to cancel both.
   *
   * Charles worked a six-hour mitigation day and two monitors on the Benns
   * loss and never tapped finish on any of them — nobody does, in the middle
   * of a flood. The close cancelled all three, billed their line items
   * anyway, and left the whole $4,052.46 crediting the one tech who was
   * there for the two-hour equipment pickup. His words: "it looks like DAVID
   * made us like $500 an hour lol which all I did was pick up equipment."
   *
   * So evidence decides, not the status flag. A visit that produced readings,
   * line items or photos was worked — mark it completed and dated to its own
   * day. Only a visit with nothing on it gets cancelled.
   */
  let cancelledVisitCount = 0
  const openVisitIds = visitList
    .filter(
      (v) =>
        v.id !== closingAppointmentId &&
        v.status !== 'completed' &&
        v.status !== 'cancelled',
    )
    .map((v) => v.id)

  if (openVisitIds.length > 0) {
    const [{ data: readingRows }, { data: lineRows }, { data: photoRows }] =
      await Promise.all([
        supabase
          .from('restoration_readings')
          .select('appointment_id')
          .in('appointment_id', openVisitIds),
        supabase
          .from('ops_appointment_line_items')
          .select('appointment_id')
          .in('appointment_id', openVisitIds),
        supabase
          .from('ops_job_photos')
          .select('appointment_id')
          .in('appointment_id', openVisitIds),
      ])

    const worked = new Set<string>()
    for (const rows of [readingRows, lineRows, photoRows]) {
      for (const row of rows ?? []) {
        const id = (row as { appointment_id?: string | null }).appointment_id
        if (id) worked.add(id)
      }
    }

    const workedIds = openVisitIds.filter((id) => worked.has(id))
    const emptyIds = openVisitIds.filter((id) => !worked.has(id))

    // Dated to the visit's own day, not to the moment of the close — the same
    // rule every other date in this system follows, because the work is
    // routinely entered after the fact.
    for (const id of workedIds) {
      const visit = visitList.find((v) => v.id === id)
      const endedAt =
        visit?.appointment_date && visit?.end_time
          ? new Date(
              `${visit.appointment_date}T${visit.end_time}`,
            ).toISOString()
          : nowIso
      await supabase
        .from('ops_appointments')
        .update({
          status: 'completed',
          completed_at: endedAt,
          updated_at: nowIso,
        })
        .eq('id', id)
        .is('completed_at', null)
    }

    if (emptyIds.length > 0) {
      await supabase
        .from('ops_appointments')
        .update({ status: 'cancelled', updated_at: nowIso })
        .in('id', emptyIds)
      cancelledVisitCount = emptyIds.length
    }
  }

  await supabase
    .from('ops_appointments')
    .update({
      visit_type: 'final',
      status: 'completed',
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', closingAppointmentId)

  await supabase
    .from('restoration_projects')
    .update({
      status: 'closed',
      invoice_id: invoice.id,
      closed_by_user_id: userId,
      dry_standard_notes: params.dryStandardNotes ?? null,
      updated_at: nowIso,
    })
    .eq('id', projectId)

  return {
    ok: true,
    invoiceId: invoice.id,
    subtotal,
    total: Number(invoice.total),
    depositCents,
    balanceCents,
    refundDueCents,
    paymentStatus,
    cancelledQueued: cancelledQueue?.length ?? 0,
    cancelledAppointments: cancelledVisitCount,
  }
}

/**
 * Place a queued monitor visit onto the calendar. Queued visits carry no date
 * because they have to be fitted around carpet cleaning work by hand.
 */
export async function scheduleQueuedVisit(
  supabase: SupabaseClient,
  params: {
    queueId: string
    appointmentDate: string
    startTime: string
    assignedStaffUserId?: string | null
    /** Overridden by tests to 'integration_test' so the booked-webhook trigger
     *  ignores the row and no fake booking alert is sent. */
    source?: string
  },
): Promise<{ ok: true; appointmentId: string } | { ok: false; error: string }> {
  const { data: queued } = await supabase
    .from('restoration_visit_queue')
    .select(
      'id, project_id, visit_type, visit_sequence, duration_minutes, status',
    )
    .eq('id', params.queueId)
    .maybeSingle()

  if (!queued) return { ok: false, error: 'queued_visit_not_found' }
  if (queued.status !== 'queued')
    return { ok: false, error: 'queued_visit_not_open' }

  const { data: project } = await supabase
    .from('restoration_projects')
    .select('id, customer_id, service_address_id, status')
    .eq('id', queued.project_id)
    .maybeSingle()

  if (!project) return { ok: false, error: 'project_not_found' }
  if (project.status !== 'active')
    return { ok: false, error: 'project_not_active' }

  const endTime = addMinutes(params.startTime, Number(queued.duration_minutes))

  const { data: appointment, error } = await supabase
    .from('ops_appointments')
    .insert({
      customer_id: project.customer_id,
      service_address_id: project.service_address_id,
      booking_channel: 'admin',
      source: params.source ?? 'admin',
      status: 'booked',
      payment_status: 'unpaid',
      quickbooks_sync_status: 'held',
      appointment_date: params.appointmentDate,
      start_time: params.startTime,
      end_time: endTime,
      quoted_total: 0,
      kind: 'restoration',
      restoration_project_id: project.id,
      visit_type: queued.visit_type,
      visit_sequence: queued.visit_sequence,
      assigned_staff_user_id: params.assignedStaffUserId ?? null,
    })
    .select('id')
    .single()

  if (error || !appointment) {
    return { ok: false, error: error?.message ?? 'appointment_insert_failed' }
  }

  await supabase
    .from('restoration_visit_queue')
    .update({
      status: 'scheduled',
      scheduled_appointment_id: appointment.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.queueId)

  return { ok: true, appointmentId: appointment.id }
}

/** "09:00" or "09:00:00" plus N minutes, as a Postgres time string. */
export function addMinutes(time: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(time)
  const base = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60
  const total = Math.max(0, Math.min(23 * 60 + 59, base + minutes))
  const h = Math.floor(total / 60)
  const min = total % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
}
