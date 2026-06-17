/**
 * Harry (next) — live wiring helpers.
 *
 * Self-contained entry points the production webhooks delegate to behind the
 * HARRY_NEXT_ENABLED flag, so the routes themselves carry almost no new logic:
 *
 *   maybeProposeServiceEditFromSms — inbound SMS → (known customer with exactly
 *     one upcoming editable job) → propose an approval. Returns handled=true
 *     only when a card was created, so the caller can suppress other handling.
 *     It never sends anything to the customer.
 *
 *   decideFromTelegramText — Charles texts "approve"/"reject" → execute/cancel
 *     the pending action. Returns handled=false for anything that isn't a
 *     decision, so normal Harry-command handling proceeds untouched.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'
import { decidePendingAction, proposeServiceEdit } from './orchestrator'
import { openAiIntentModel } from './model'
import type { IntentModel } from './read-intent'

const PENDING_TABLE = 'harry_next_pending_actions'

function todayMountain(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

export async function maybeProposeServiceEditFromSms(params: {
  supabase: SupabaseClient
  phone: string
  message: string
  model?: IntentModel
}): Promise<{ handled: boolean; status?: string }> {
  const { supabase, phone, message } = params

  // Known scheduled customer?
  const { data: customer } = await supabase
    .from('ops_customers')
    .select('id, first_name, full_name')
    .in('phone', opsPhoneLookupVariants(phone))
    .maybeSingle()
  if (!customer) return { handled: false }

  // Require EXACTLY ONE upcoming editable job — never guess which one to touch.
  const { data: appts } = await supabase
    .from('ops_appointments')
    .select('id')
    .eq('customer_id', customer.id)
    .gte('appointment_date', todayMountain())
    .in('status', ['booked', 'confirmed'])
    .order('appointment_date', { ascending: true })
    .limit(2)
  if (!appts || appts.length !== 1) return { handled: false }

  const result = await proposeServiceEdit({
    supabase,
    model: params.model ?? openAiIntentModel(),
    conversationId: null,
    appointmentId: String(appts[0].id),
    customerName: customer.first_name || customer.full_name || null,
    recipientPhone: phone,
    customerMessage: message,
  })

  return { handled: result.status === 'proposed', status: result.status }
}

// Strict: only the exact words on the approval card trigger a decision, so a
// normal Charles command ("no problem", "yes book it") is never hijacked.
const DECISION_RE = /^\s*(approve|reject)\b/i
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function parseDecisionText(
  text: string,
): { decision: 'approve' | 'reject'; id: string | null } | null {
  const match = DECISION_RE.exec(text || '')
  if (!match) return null
  return {
    decision: match[1].toLowerCase() === 'approve' ? 'approve' : 'reject',
    id: UUID_RE.exec(text)?.[0] ?? null,
  }
}

export async function decideFromTelegramText(params: {
  supabase: SupabaseClient
  text: string
}): Promise<{ handled: boolean; message?: string }> {
  const parsed = parseDecisionText(params.text)
  if (!parsed) return { handled: false }

  let pendingId = parsed.id
  if (!pendingId) {
    const { data: latest } = await params.supabase
      .from(PENDING_TABLE)
      .select('id')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    pendingId = latest?.id ? String(latest.id) : null
  }
  if (!pendingId) {
    return { handled: true, message: 'No pending Harry approval to act on.' }
  }

  const result = await decidePendingAction({
    supabase: params.supabase,
    pendingActionId: pendingId,
    decision: parsed.decision,
    decidedBy: 'telegram',
  })

  const messages: Record<string, string> = {
    executed: '✅ Sent — the change is applied and the customer was messaged.',
    rejected: '🚫 Rejected — nothing was changed or sent.',
    already_decided: 'That approval was already handled.',
    stale:
      '⚠️ The job changed since this was proposed, so I did not send it. Please take a look.',
    failed: `⚠️ Could not complete it${result.reason ? `: ${result.reason}` : ''}.`,
  }
  return { handled: true, message: messages[result.status] ?? 'Done.' }
}
