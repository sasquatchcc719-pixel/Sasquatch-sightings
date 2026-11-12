import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MISSED_CALL_EVENT } from './events'

export type FinalizedCall = {
  callSid: string
  phone: string
  outcome: string
  startedAt: string | null
  endedAt: string | null
}

// Delivery grace is not a polling scan. Only signed, finalized live calls
// enter the existing durable webhook outbox; late voicemail callbacks win.
export const MISSED_CALL_GRACE_MS = 90_000
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000

export async function missedCallStillEligible(
  db: SupabaseClient,
  callSid: string,
  occurredAt: string,
) {
  if (!/^CA[0-9a-f]{32}$/i.test(callSid)) return false
  const started = Date.parse(occurredAt)
  if (
    !Number.isFinite(started) ||
    started > Date.now() ||
    Date.now() - started > MAX_EVENT_AGE_MS
  )
    return false
  const { data: call, error } = await db
    .from('call_logs')
    .select(
      'call_sid,caller_phone,direction,outcome,recording_url,transcription,forwarding_accepted_at',
    )
    .eq('call_sid', callSid)
    .maybeSingle()
  if (error) throw error
  return Boolean(
    call?.direction === 'inbound' &&
    call.outcome === 'no-answer' &&
    /^\+[1-9][0-9]{7,14}$/.test(call.caller_phone ?? '') &&
    !call.recording_url &&
    !call.transcription &&
    !call.forwarding_accepted_at,
  )
}

export async function enqueueMissedCallEvent(
  db: SupabaseClient,
  call: FinalizedCall,
) {
  if (call.outcome !== 'no-answer' || !call.startedAt || !call.endedAt) return 0
  if (!(await missedCallStillEligible(db, call.callSid, call.startedAt)))
    return 0
  const { data: subscriptions, error } = await db
    .from('mcp_event_subscriptions')
    .select('id,created_at')
    .eq('event_name', MISSED_CALL_EVENT)
    .eq('status', 'active')
    .lte('created_at', call.startedAt)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
  if (error) throw error
  if (!subscriptions?.length) return 0

  // Real call context, not a fabricated customer SMS. Existing conversation
  // settings and messages are unchanged; unknown callers get an empty thread.
  const { data: conversationId, error: contextError } = await db.rpc(
    'ensure_missed_call_conversation',
    { p_call_sid: call.callSid },
  )
  if (contextError) throw contextError
  if (!conversationId) return 0
  const eventId = `call_${createHash('sha256').update(call.callSid).digest('hex').slice(0, 32)}`
  const rows = subscriptions.map((subscription) => ({
    id: `evt_${createHash('sha256').update(`${subscription.id}:${eventId}`).digest('hex').slice(0, 40)}`,
    subscription_id: subscription.id,
    event_id: eventId,
    event_name: MISSED_CALL_EVENT,
    occurred_at: call.startedAt,
    next_attempt_at: new Date(Date.now() + MISSED_CALL_GRACE_MS).toISOString(),
    payload: {
      call_sid: call.callSid,
      conversation_id: conversationId,
      occurred_at: call.startedAt,
      finalized_at: call.endedAt,
    },
  }))
  const { error: deliveryError } = await db
    .from('mcp_event_deliveries')
    .upsert(rows, {
      onConflict: 'subscription_id,event_id',
      ignoreDuplicates: true,
    })
  if (deliveryError) throw deliveryError
  return rows.length
}
