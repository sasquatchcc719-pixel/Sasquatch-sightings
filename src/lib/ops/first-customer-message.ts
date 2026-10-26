import type { SupabaseClient } from '@supabase/supabase-js'
import { sendCustomerSMSWithResult } from '@/lib/twilio'

export class FirstMessageOutcomeError extends Error {
  constructor(readonly result: Record<string, unknown>) {
    super(String(result.warning || 'First-contact message did not complete'))
  }
}
/** Only explicit provider rejections or known local pre-send suppression prove no send. */
export function definitelyRejected(error: unknown) {
  const e = error as { status?: number; code?: number; message?: string }
  return (
    ([400, 401, 403, 404, 422].includes(Number(e?.status)) &&
      Number.isInteger(e?.code)) ||
    /^(Suppressed:|Twilio credentials not configured|Twilio sender is not configured)/.test(
      e?.message || '',
    )
  )
}
export async function sendFirstCustomerMessage(
  db: SupabaseClient,
  previewId: string,
  actorId: string,
  send: typeof sendCustomerSMSWithResult = sendCustomerSMSWithResult,
) {
  const claim = await db.rpc('claim_mcp_first_message', {
    p_preview: previewId,
    p_actor: actorId,
  })
  if (claim.error) throw claim.error
  if (!claim.data?.claimed)
    throw new FirstMessageOutcomeError({
      ...claim.data,
      warning:
        'A first-contact attempt already exists for this phone. Inspect its ledger/provider outcome; do not resend.',
    })
  const message = claim.data as {
    phone: string
    body: string
    customer_id: string
  }
  let sid: string
  try {
    const result = await send(
      message.phone,
      message.body,
      undefined,
      'admin_outbound',
      undefined,
      {
        customerId: message.customer_id,
        sentBy: 'Owner-approved Sightings first contact',
      },
    )
    sid = result.sid
  } catch (error) {
    const status = definitelyRejected(error) ? 'rejected' : 'unknown'
    const settled = await db.rpc('finish_mcp_first_message', {
      p_preview: previewId,
      p_actor: actorId,
      p_status: status,
      p_sid: null,
      p_error: String((error as { code?: unknown })?.code || status),
    })
    throw new FirstMessageOutcomeError({
      status: settled.error ? 'unknown' : status,
      history_recorded: false,
      warning:
        status === 'rejected' && !settled.error
          ? 'Provider rejected the message; it was not sent. The attempt is recorded and will not retry automatically.'
          : 'Provider outcome is uncertain. The phone remains blocked for retry until provider and attempt records are reconciled.',
    })
  }
  const finished = await db.rpc('finish_mcp_first_message', {
    p_preview: previewId,
    p_actor: actorId,
    p_status: 'accepted',
    p_sid: sid,
    p_error: null,
  })
  if (finished.error)
    throw new FirstMessageOutcomeError({
      status: 'accepted_history_pending',
      twilio_sid: sid,
      history_recorded: false,
      warning:
        'Twilio accepted the message, but durable history finalization failed. Do not resend; reconcile this SID.',
    })
  return { ...finished.data, to: message.phone }
}
