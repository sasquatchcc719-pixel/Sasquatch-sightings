/**
 * Harry (next) — orchestrator.
 *
 * Two entry points, both glue over the verified core:
 *   proposeServiceEdit  — inbound text → typed intent → diff plan → pending row
 *                         + Telegram approval card. Writes NOTHING to the job
 *                         and sends NOTHING to the customer.
 *   decidePendingAction — owner approves/rejects. On approve it RE-PLANS against
 *                         the job's current state and refuses to proceed if the
 *                         total changed since it was proposed (says = does, even
 *                         if the world moved). Only then does it apply the diff
 *                         and send the approved message — to the bound recipient.
 *
 * This layer is verified on first live run; the pure pieces it composes are
 * unit-tested.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTelegramNotification } from '@/lib/telegram'
import { sendCustomerSMS } from '@/lib/twilio'
import { applyServiceRemoval } from './apply-removal'
import { planRemovalExecution, type ExistingAppointmentLine } from './executor'
import { serviceEditIntent, type RemoveServiceIntent } from './intents'
import { buildApprovalCard } from './proposal-card'
import { readServiceEditIntent, type IntentModel } from './read-intent'
import { composeRemovalReply } from './service-edit'

const PENDING_TABLE = 'harry_next_pending_actions'

/** What we persist on the pending row so approval is fully self-contained. */
type StoredPayload = {
  kind: 'remove_service'
  intent: RemoveServiceIntent
  appointmentId: string
  expectedNewTotal: number
}

function firstNameOf(name: string | null): string | null {
  const trimmed = (name || '').trim()
  return trimmed ? trimmed.split(/\s+/)[0] : null
}

async function loadAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<{ startTime: string; lines: ExistingAppointmentLine[] } | null> {
  const { data: appt } = await supabase
    .from('ops_appointments')
    .select('start_time')
    .eq('id', appointmentId)
    .maybeSingle()
  if (!appt) return null

  const { data: rows } = await supabase
    .from('ops_appointment_line_items')
    .select(
      'id, service_catalog_item_id, name_snapshot, quantity, unit_price, duration_minutes, buffer_minutes',
    )
    .eq('appointment_id', appointmentId)

  const lines: ExistingAppointmentLine[] = (rows ?? []).map((r) => ({
    id: String(r.id),
    serviceCatalogItemId: r.service_catalog_item_id
      ? String(r.service_catalog_item_id)
      : null,
    nameSnapshot: String(r.name_snapshot),
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    durationMinutes: Number(r.duration_minutes),
    bufferMinutes: Number(r.buffer_minutes),
  }))

  return { startTime: String(appt.start_time), lines }
}

export type ProposeResult =
  | { status: 'proposed'; pendingActionId: string }
  | { status: 'no_action' }
  | { status: 'needs_clarification'; reason: string }
  | { status: 'error'; reason: string }

export async function proposeServiceEdit(params: {
  supabase: SupabaseClient
  model: IntentModel
  conversationId: string
  appointmentId: string
  customerName: string | null
  recipientPhone: string
  customerMessage: string
}): Promise<ProposeResult> {
  const job = await loadAppointment(params.supabase, params.appointmentId)
  if (!job) return { status: 'error', reason: 'appointment not found' }

  const read = await readServiceEditIntent({
    customerMessage: params.customerMessage,
    currentServices: job.lines.map((l) => l.nameSnapshot),
    model: params.model,
  })
  if (read.status !== 'intent') return { status: 'no_action' }
  if (read.intent.type !== 'remove_service') return { status: 'no_action' }

  const exec = planRemovalExecution({
    startTime: job.startTime,
    appointmentLines: job.lines,
    intent: read.intent,
  })
  if (exec.status === 'not_found') {
    return {
      status: 'needs_clarification',
      reason: `No current service matches "${read.intent.match}".`,
    }
  }
  if (exec.status === 'ambiguous') {
    return {
      status: 'needs_clarification',
      reason: `"${read.intent.match}" matches several services: ${exec.candidates.join(', ')}.`,
    }
  }

  const reply = composeRemovalReply({
    removedName: exec.removedName,
    newTotal: exec.newQuotedTotal,
    belowMinimum: exec.belowMinimum,
    firstName: firstNameOf(params.customerName),
  })
  const actionSummary = `Remove "${exec.removedName}" — new total $${exec.newQuotedTotal.toFixed(2)}`

  const payload: StoredPayload = {
    kind: 'remove_service',
    intent: read.intent,
    appointmentId: params.appointmentId,
    expectedNewTotal: exec.newQuotedTotal,
  }

  const { data: inserted, error } = await params.supabase
    .from(PENDING_TABLE)
    .insert({
      conversation_id: params.conversationId,
      recipient_phone: params.recipientPhone,
      intent: payload,
      action_summary: actionSummary,
      proposed_reply: reply,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return {
      status: 'error',
      reason: error?.message ?? 'failed to save pending action',
    }
  }

  const card = buildApprovalCard({
    customerName: params.customerName,
    recipientPhone: params.recipientPhone,
    actionSummary,
    proposedReply: reply,
  })
  // Plain text (no Markdown) so a stray * or _ in a service name can't break it.
  await sendTelegramNotification(`${card}\n\nid: ${inserted.id}`)

  return { status: 'proposed', pendingActionId: String(inserted.id) }
}

export type DecideResult = {
  status: 'executed' | 'rejected' | 'already_decided' | 'stale' | 'failed'
  reason?: string
}

export async function decidePendingAction(params: {
  supabase: SupabaseClient
  pendingActionId: string
  decision: 'approve' | 'reject'
  decidedBy?: string
}): Promise<DecideResult> {
  const { data: row, error } = await params.supabase
    .from(PENDING_TABLE)
    .select('*')
    .eq('id', params.pendingActionId)
    .maybeSingle()
  if (error || !row)
    return { status: 'failed', reason: 'pending action not found' }
  if (row.status !== 'pending') return { status: 'already_decided' }

  const now = new Date().toISOString()

  if (params.decision === 'reject') {
    await params.supabase
      .from(PENDING_TABLE)
      .update({
        status: 'rejected',
        decided_at: now,
        decided_by: params.decidedBy ?? null,
      })
      .eq('id', row.id)
    return { status: 'rejected' }
  }

  const payload = row.intent as StoredPayload
  const intentParse = serviceEditIntent.safeParse(payload?.intent)
  if (!intentParse.success || intentParse.data.type !== 'remove_service') {
    await markFailed(params.supabase, row.id, now, 'stored intent invalid')
    return { status: 'failed', reason: 'stored intent invalid' }
  }

  const job = await loadAppointment(params.supabase, payload.appointmentId)
  if (!job) {
    await markFailed(params.supabase, row.id, now, 'appointment not found')
    return { status: 'failed', reason: 'appointment not found' }
  }

  // Re-plan against CURRENT state. If anything moved, do not send a stale number.
  const exec = planRemovalExecution({
    startTime: job.startTime,
    appointmentLines: job.lines,
    intent: intentParse.data,
  })
  if (
    exec.status !== 'ready' ||
    exec.newQuotedTotal !== payload.expectedNewTotal
  ) {
    await markFailed(
      params.supabase,
      row.id,
      now,
      'job changed since this was proposed — not sent',
    )
    return { status: 'stale', reason: 'the job changed since it was proposed' }
  }

  const applied = await applyServiceRemoval(params.supabase, {
    appointmentId: payload.appointmentId,
    deleteAppointmentLineItemId: exec.deleteAppointmentLineItemId,
    keptLines: exec.keptLines,
    newQuotedTotal: exec.newQuotedTotal,
    newEndTime: exec.newEndTime,
  })
  if (applied.status === 'error') {
    await markFailed(params.supabase, row.id, now, applied.reason)
    return { status: 'failed', reason: applied.reason }
  }

  // The change is in. Send the approved message to the BOUND recipient only.
  await sendCustomerSMS(
    String(row.recipient_phone),
    String(row.proposed_reply),
    undefined,
    'harry_next',
  )

  await params.supabase
    .from(PENDING_TABLE)
    .update({
      status: 'executed',
      decided_at: now,
      decided_by: params.decidedBy ?? null,
      executed_at: now,
      execution_error:
        applied.status === 'needs_manual_invoice' ? applied.reason : null,
    })
    .eq('id', row.id)

  return { status: 'executed' }
}

async function markFailed(
  supabase: SupabaseClient,
  id: string,
  at: string,
  reason: string,
): Promise<void> {
  await supabase
    .from(PENDING_TABLE)
    .update({ status: 'failed', decided_at: at, execution_error: reason })
    .eq('id', id)
}
