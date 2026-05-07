import type { SupabaseClient } from '@supabase/supabase-js'
import { runRangerTelegramAction } from './actions'
import { hashRangerActionPayload } from './memory'
import { sendRangerApplicantSms } from './sms'
import type { RangerApplicant, RangerPendingAction } from './types'

async function loadApplicant(
  supabase: SupabaseClient,
  applicantId: string | null,
) {
  if (!applicantId) return null
  const { data, error } = await supabase
    .from('ranger_applicants')
    .select('*')
    .eq('id', applicantId)
    .maybeSingle()
  if (error) throw error
  return data as RangerApplicant | null
}

export async function cancelRangerPendingAction(params: {
  supabase: SupabaseClient
  actionId: string
  actor: string
}) {
  const { data: action, error: actionError } = await params.supabase
    .from('ranger_pending_actions')
    .update({
      status: 'cancelled',
      cancelled_by: params.actor,
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', params.actionId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle()

  if (actionError) throw actionError
  if (!action) return 'That Ranger action was already handled or expired.'
  return `Cancelled Ranger action: ${(action as RangerPendingAction).action_type}.`
}

export async function approveAndExecuteRangerPendingAction(params: {
  supabase: SupabaseClient
  actionId: string
  actor: string
}) {
  const { data, error } = await params.supabase
    .from('ranger_pending_actions')
    .select('*')
    .eq('id', params.actionId)
    .maybeSingle()

  if (error) throw error
  if (!data) return 'I could not find that pending Ranger action.'
  const action = data as RangerPendingAction
  if (action.status !== 'pending') {
    return `That Ranger action is already ${action.status}.`
  }
  if (new Date(action.expires_at).getTime() < Date.now()) {
    await params.supabase
      .from('ranger_pending_actions')
      .update({ status: 'expired' })
      .eq('id', action.id)
    return 'That Ranger approval expired. Ask me to queue it again.'
  }
  if (hashRangerActionPayload(action.payload) !== action.payload_hash) {
    await params.supabase
      .from('ranger_pending_actions')
      .update({
        status: 'failed',
        result: { ok: false, summary: 'Payload hash mismatch.' },
      })
      .eq('id', action.id)
    return 'I refused that action because the approval payload did not match its hash.'
  }

  const applicant = await loadApplicant(params.supabase, action.applicant_id)
  let result = ''
  try {
    if (action.action_type === 'pass' || action.action_type === 'hire') {
      result = await runRangerTelegramAction({
        supabase: params.supabase,
        action: action.action_type,
        applicantId: action.applicant_id || undefined,
        actor: params.actor,
      })
    } else if (action.action_type === 'custom_sms') {
      if (!applicant) return 'I could not find that applicant anymore.'
      const message =
        typeof action.payload.message === 'string' ? action.payload.message : ''
      if (!message.trim()) return 'That approved SMS had no message body.'
      result = await sendRangerApplicantSms({
        supabase: params.supabase,
        applicant,
        actor: params.actor,
        message,
      })
    } else {
      result = `I do not know how to execute pending action ${action.action_type}.`
    }

    await params.supabase
      .from('ranger_pending_actions')
      .update({
        status: 'executed',
        approved_by: params.actor,
        approved_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        result: { ok: true, summary: result },
      })
      .eq('id', action.id)
    return result
  } catch (executionError) {
    const message =
      executionError instanceof Error ? executionError.message : 'Unknown error'
    await params.supabase
      .from('ranger_pending_actions')
      .update({
        status: 'failed',
        approved_by: params.actor,
        approved_at: new Date().toISOString(),
        result: { ok: false, summary: message },
      })
      .eq('id', action.id)
    throw executionError
  }
}
