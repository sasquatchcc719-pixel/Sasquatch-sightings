import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'
import { digest, mountainDate, type Gap } from './gap-planning'
import { readGapCandidates, reloadGap } from './gap-read'

export type GapActor = { subject: string; label: string; scopes: string[] }
export function requireGapScope(actor: GapActor, contact = false) {
  if (
    !actor.scopes.includes('outreach:write') ||
    (contact && !actor.scopes.includes('customer:contact'))
  )
    throw new Error(
      'Explicit outreach:write and customer:contact grants are required',
    )
}
export function gapInvitation(name: string, gap: Gap) {
  return `Hi ${name.split(' ')[0] || 'there'}, Sasquatch Carpet Cleaning is arranging returning-customer visits around our ${gap.date} schedule, especially between ${gap.start_time.slice(0, 5)} and ${gap.end_time.slice(0, 5)}. Interested in a cleaning? Tell us what you need and we will confirm the services, price and available time with you. Your approved returning-customer offer is $35 off service of $300 or more before travel, fees and tax; no other discounts combine. Other available times are welcome too. Reply STOP to opt out.`
}
async function rpc<T>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args)
  if (error) throw error
  return data as T
}
export async function previewGapOutreach(
  db: SupabaseClient,
  input: { gap: Gap; customer_ids: string[]; idempotency_key: string },
  actor: GapActor,
  now = new Date(),
) {
  requireGapScope(actor, true)
  if (
    input.customer_ids.length < 1 ||
    input.customer_ids.length > 5 ||
    new Set(input.customer_ids).size !== input.customer_ids.length
  )
    throw new Error('Approve one to five distinct named customers')
  const ranked = await readGapCandidates(db, input.gap, 1000, now)
  const recipients = input.customer_ids.map((id) => {
    const c = ranked.data.find((c) => c.customer_id === id)
    if (!c || !c.phone)
      throw new Error('A selected customer is no longer eligible')
    const hex = digest({ actor: actor.subject, key: input.idempotency_key, id })
    const recipientId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
    return {
      id: recipientId,
      customer_id: id,
      phone: c.phone,
      conversation_id: c.conversation_id,
      conversation_updated_at: c.conversation_updated_at,
      body: gapInvitation(c.name, input.gap),
      name: c.name,
      from: c.business_number,
      eligibility_hash: digest(c),
    }
  })
  const payload = {
    gap: input.gap,
    recipients,
    offer: {
      code: 'TF35',
      amount: 35,
      minimum_service_cents: 30000,
      alternate_time_policy: 'requires_owner_decision',
      stacking: false,
    },
  }
  if (input.gap.date <= mountainDate(now))
    throw new Error('Outreach cutoff passed; choose a future-day gap')
  const expires_at = new Date(now.getTime() + 10 * 60000).toISOString()
  return rpc<Record<string, unknown>>(db, 'preview_gap_outreach', {
    p_actor: actor.subject,
    p_key: input.idempotency_key,
    p_payload: payload,
    p_hash: digest(payload),
    p_expires: expires_at,
  })
}
export async function readGapOutreach(db: SupabaseClient, id: string) {
  const batch = await db
    .from('gap_outreach_batches')
    .select(
      'id,actor_user_id,status,payload,created_at,expires_at,approved_at,stop_reason',
    )
    .eq('id', id)
    .single()
  if (batch.error) throw batch.error
  const recipients = await db
    .from('gap_outreach_recipients')
    .select(
      'id,customer_id,status,body,provider_sid,provider_status,attempted_at,sent_at,stop_reason,appointment_id',
    )
    .eq('batch_id', id)
    .order('id')
  if (recipients.error) throw recipients.error
  return { batch: batch.data, recipients: recipients.data }
}
export async function stopGapOutreach(
  db: SupabaseClient,
  id: string,
  actor: GapActor,
) {
  requireGapScope(actor)
  return rpc<Record<string, unknown>>(db, 'stop_gap_outreach', {
    p_batch: id,
    p_actor: actor.subject,
    p_reason: 'owner_takeover',
  })
}

export type GapSendDependencies = {
  now?: () => Date
  enabled?: () => boolean
  send?: typeof sendCustomerSMSWithResult
  reload?: typeof reloadGap
  candidates?: typeof readGapCandidates
}
/** No background recurrence and no replacement recipients. Unknown outcomes are never retried. */
export async function executeGapOutreach(
  db: SupabaseClient,
  id: string,
  actor: GapActor,
  deps: GapSendDependencies = {},
) {
  requireGapScope(actor, true)
  if (!(deps.enabled?.() ?? process.env.GAP_OUTREACH_ENABLED === 'true'))
    throw new Error(
      'Gap outreach activation is held; GAP_OUTREACH_ENABLED is off',
    )
  const state = await readGapOutreach(db, id)
  if (state.batch.actor_user_id !== actor.subject)
    throw new Error('Approval belongs to another owner')
  const payload = state.batch.payload as {
    gap: Gap
    recipients: Array<{
      id: string
      customer_id: string
      eligibility_hash: string
      body: string
      phone: string
      from: string | null
    }>
  }
  // Retries can inspect terminal results but must never resume a partially attempted wave.
  if (state.batch.status !== 'pending') return state
  const now = deps.now?.() || new Date()
  if (Date.parse(state.batch.expires_at) <= now.getTime())
    throw new Error('Approval expired; preview again')
  await (deps.reload || reloadGap)(db, payload.gap, now)
  const claimed = await rpc<boolean>(db, 'approve_gap_outreach', {
    p_batch: id,
    p_actor: actor.subject,
    p_hash: digest(payload),
  })
  if (!claimed) return readGapOutreach(db, id)
  for (const recipient of payload.recipients) {
    try {
      const currentTime = deps.now?.() || new Date()
      await (deps.reload || reloadGap)(db, payload.gap, currentTime)
      const current = await (deps.candidates || readGapCandidates)(
        db,
        payload.gap,
        1000,
        currentTime,
      )
      const customer = current.data.find(
        (c) => c.customer_id === recipient.customer_id,
      )
      if (!customer || digest(customer) !== recipient.eligibility_hash) {
        await rpc(db, 'stop_gap_outreach', {
          p_batch: id,
          p_actor: actor.subject,
          p_reason: 'eligibility_or_conversation_changed',
        })
        break
      }
      const send = await rpc<boolean>(db, 'claim_gap_outreach_recipient', {
        p_recipient: recipient.id,
        p_actor: actor.subject,
      })
      if (!send) continue
      // Once claimed, every exception is uncertain; reconcile provider evidence before any retry.
      // A concurrent booking/takeover cancels unclaimed work. An in-flight SMS cannot be recalled.
      const stillValid = await rpc<boolean>(db, 'check_gap_outreach_send', {
        p_recipient: recipient.id,
        p_actor: actor.subject,
      })
      if (!stillValid) break
      const result = await (deps.send || sendCustomerSMSWithResult)(
        recipient.phone,
        recipient.body,
        undefined,
        'gap_outreach',
        recipient.from || undefined,
        {
          customerId: recipient.customer_id,
          gapOutreachRecipientId: recipient.id,
          sentBy: actor.label,
        },
      )
      await rpc(db, 'finish_gap_outreach_recipient', {
        p_recipient: recipient.id,
        p_actor: actor.subject,
        p_sid: result.sid,
        p_status: 'accepted',
      })
    } catch {
      await rpc(db, 'mark_gap_outreach_uncertain', {
        p_batch: id,
        p_actor: actor.subject,
      })
      break
    }
  }
  return readGapOutreach(db, id)
}
