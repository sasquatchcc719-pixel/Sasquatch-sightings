import type { SupabaseClient } from '@supabase/supabase-js'
import { definitelyRejected } from '@/lib/ops/first-customer-message'

export function missedCallSid(key: string): string | null {
  if (!key.startsWith('missed-call:')) return null
  const match = /^missed-call:(CA[0-9a-fA-F]{32}):v1$/.exec(key)
  if (!match) throw new Error('Invalid missed-call idempotency key')
  return match[1]
}

export type CallFollowUpClaim = { call_sid: string; token: string }

export async function claimCallFollowUp(db: SupabaseClient, input: {
  phone: string
  callSid?: string
  recordingSid?: string
  conversationId?: string
  previewOnly?: boolean
}): Promise<CallFollowUpClaim | null> {
  const { data, error } = await db.rpc('claim_call_follow_up', {
    p_phone: input.phone,
    p_call_sid: input.callSid || null,
    p_recording_sid: input.recordingSid || null,
    p_preview_only: Boolean(input.previewOnly),
    p_conversation_id: input.conversationId || null,
  })
  if (error) throw error
  return data?.eligible ? data : null
}

export async function finishCallFollowUp(db: SupabaseClient, claim: CallFollowUpClaim,
  status: 'accepted' | 'unknown' | 'rejected' | 'suppressed' | 'skipped', sid?: string) {
  const { error } = await db.rpc('finish_call_follow_up', {
    p_call_sid: claim.call_sid, p_token: claim.token,
    p_status: status, p_twilio_sid: sid || null,
  })
  if (error) throw error
}

/** Never release a claim after entering provider I/O, even when persistence fails. */
export async function sendClaimedCallFollowUp<T extends { twilio_sid?: string; sid?: string }>(
  db: SupabaseClient, claim: CallFollowUpClaim, send: () => Promise<T>,
): Promise<T> {
  let result: T
  try {
    result = await send()
  } catch (error) {
    await finishCallFollowUp(db, claim, definitelyRejected(error) ? 'rejected' : 'unknown')
    throw error
  }
  const sid = result.twilio_sid || result.sid
  if (!sid) {
    await finishCallFollowUp(db, claim, 'unknown')
    throw new Error('Provider outcome uncertain; reconcile call claim before another send')
  }
  try {
    await finishCallFollowUp(db, claim, 'accepted', sid)
  } catch {
    throw new Error(`Provider accepted ${sid}; call history finalization pending. Do not resend.`)
  }
  return result
}
