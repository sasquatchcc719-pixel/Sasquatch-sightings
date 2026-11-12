import { Resend } from 'resend'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FinalizedCall } from './missed-call-events'
import { MISSED_CALL_GRACE_MS } from './missed-call-events'

export const MISSED_CALL_EMAIL_SUBJECT_PREFIX = 'Sasquatch missed call:'
export const MISSED_CALL_EMAIL_IDEMPOTENCY_PREFIX =
  'missed-call-owner-notice-v1/'
export const MISSED_CALL_EMAIL_SENDER =
  'Sasquatch Carpet Cleaning <noreply@sasquatchcarpet.com>'
export const MISSED_CALL_EMAIL_RECIPIENT = 'sasquatchcc719@gmail.com'
const EMAIL_PROVIDER_TIMEOUT_MS = 10_000
const EMAIL_WORKER_BUDGET_MS = 45_000
const EMAIL_FINALIZATION_HEADROOM_MS = 5_000

type EmailClaim = {
  eligible: boolean
  reason?: string
  call_sid?: string
  token?: string
  conversation_id?: string
  occurred_at?: string
  finalized_at?: string
  sender?: string
  recipient?: string
  subject?: string
  body_text?: string
}

type EmailSender = (input: {
  from: string
  to: string
  subject: string
  text: string
  idempotencyKey: string
}) => Promise<{
  id?: string | null
  error?:
    | string
    | { message?: string; statusCode?: number | null; name?: string }
    | null
}>

function bridgeConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const sender = process.env.OPS_EMAIL_FROM?.trim()
  const recipient = process.env.OWNER_ALERT_EMAIL?.trim().toLowerCase()
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured')
  if (!sender) throw new Error('OPS_EMAIL_FROM is not configured')
  if (!recipient) throw new Error('OWNER_ALERT_EMAIL is not configured')
  if (sender !== MISSED_CALL_EMAIL_SENDER)
    throw new Error('OPS_EMAIL_FROM is not the verified Sasquatch sender')
  if (recipient !== MISSED_CALL_EMAIL_RECIPIENT)
    throw new Error('OWNER_ALERT_EMAIL is not the verified owner mailbox')
  return { apiKey, sender, recipient }
}

export function buildMissedCallOwnerEmail(input: {
  callSid: string
  conversationId: string
  occurredAt: string
  finalizedAt: string
}) {
  return {
    subject: `${MISSED_CALL_EMAIL_SUBJECT_PREFIX} ${input.callSid}`,
    text: [
      'Sasquatch Carpet Cleaning missed-call notice',
      '',
      `CallSid: ${input.callSid}`,
      `Provider started at: ${input.occurredAt}`,
      `Finalized at: ${input.finalizedAt}`,
      `Conversation ID: ${input.conversationId}`,
      '',
      'This is an internal owner notification for a verified future missed call.',
      'It contains no caller message. Validate the CallSid and live conversation in Sasquatch Sightings before any follow-up.',
    ].join('\n'),
  }
}

export async function enqueueMissedCallEmailBridge(
  db: SupabaseClient,
  call: FinalizedCall,
) {
  if (
    call.outcome !== 'no-answer' ||
    !call.startedAt ||
    !call.endedAt ||
    !/^CA[0-9a-f]{32}$/i.test(call.callSid)
  )
    return false
  const { sender, recipient } = bridgeConfiguration()
  const { data: conversationId, error: contextError } = await db.rpc(
    'ensure_missed_call_bridge_conversation',
    { p_call_sid: call.callSid },
  )
  if (contextError) throw contextError
  if (!conversationId) return false
  const email = buildMissedCallOwnerEmail({
    callSid: call.callSid,
    conversationId: String(conversationId),
    occurredAt: call.startedAt,
    finalizedAt: call.endedAt,
  })
  const { error } = await db.from('missed_call_email_notifications').insert({
    call_sid: call.callSid,
    conversation_id: conversationId,
    occurred_at: call.startedAt,
    finalized_at: call.endedAt,
    available_at: new Date(Date.now() + MISSED_CALL_GRACE_MS).toISOString(),
    sender,
    recipient,
    subject: email.subject,
    body_text: email.text,
  })
  if (!error) return true
  if (error.code === '23505') return false
  throw error
}

async function finishEmail(
  db: SupabaseClient,
  claim: EmailClaim,
  status: 'accepted' | 'unknown' | 'rejected',
  providerId?: string,
  errorMessage?: string,
) {
  const { error } = await db.rpc('finish_missed_call_email_notification', {
    p_call_sid: claim.call_sid,
    p_token: claim.token,
    p_status: status,
    p_provider_id: providerId || null,
    p_error: errorMessage || null,
  })
  if (error) throw error
}

function defaultEmailSender(apiKey: string): EmailSender {
  const resend = new Resend(apiKey)
  return async (input) => {
    const { data, error } = await resend.emails.send(
      {
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      },
      { idempotencyKey: input.idempotencyKey },
    )
    return {
      id: data?.id,
      error: error
        ? {
            message: error.message,
            statusCode: error.statusCode,
            name: error.name,
          }
        : null,
    }
  }
}

function emailErrorDetails(error: Awaited<ReturnType<EmailSender>>['error']) {
  if (!error) return { message: null, definitelyRejected: false }
  if (typeof error === 'string')
    return { message: error, definitelyRejected: false }
  const status = Number(error.statusCode)
  return {
    message: error.message || error.name || 'email provider error',
    definitelyRejected:
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500 &&
      ![408, 409, 425, 429].includes(status),
  }
}

async function withProviderTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('email provider timeout')),
          EMAIL_PROVIDER_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function deliverPendingMissedCallEmails(params: {
  db: SupabaseClient
  sendEmail?: EmailSender
}) {
  const workerStartedAt = Date.now()
  const now = new Date().toISOString()
  const { data: pending, error } = await params.db
    .from('missed_call_email_notifications')
    .select('call_sid')
    .eq('status', 'pending')
    .lte('available_at', now)
    .order('available_at', { ascending: true })
    .limit(5)
  if (error) throw error

  let accepted = 0
  let suppressed = 0
  let rejected = 0
  let unknown = 0
  let sender: EmailSender | undefined = params.sendEmail
  let senderConfigurationError: Error | null = null
  if (!sender) {
    try {
      sender = defaultEmailSender(bridgeConfiguration().apiKey)
    } catch (configurationError) {
      senderConfigurationError =
        configurationError instanceof Error
          ? configurationError
          : new Error(String(configurationError))
    }
  }

  for (const row of pending || []) {
    if (
      Date.now() - workerStartedAt >
      EMAIL_WORKER_BUDGET_MS -
        EMAIL_PROVIDER_TIMEOUT_MS -
        EMAIL_FINALIZATION_HEADROOM_MS
    )
      break
    const { data, error: claimError } = await params.db.rpc(
      'claim_missed_call_email_notification',
      { p_call_sid: row.call_sid },
    )
    if (claimError) throw claimError
    const claim = data as EmailClaim | null
    if (!claim?.eligible) {
      if (
        !['settling', 'not_pending', 'call_phone_changed'].includes(
          claim?.reason || '',
        )
      )
        suppressed += 1
      continue
    }
    if (
      !claim.call_sid ||
      !claim.token ||
      !claim.sender ||
      !claim.recipient ||
      !claim.subject ||
      !claim.body_text
    ) {
      await finishEmail(
        params.db,
        claim,
        'rejected',
        undefined,
        'claimed email evidence was incomplete',
      )
      rejected += 1
      continue
    }
    if (
      claim.sender !== MISSED_CALL_EMAIL_SENDER ||
      claim.recipient.trim().toLowerCase() !== MISSED_CALL_EMAIL_RECIPIENT
    ) {
      await finishEmail(
        params.db,
        claim,
        'rejected',
        undefined,
        'claimed email route is not the verified owner path',
      )
      rejected += 1
      continue
    }
    if (!sender) {
      await finishEmail(
        params.db,
        claim,
        'rejected',
        undefined,
        senderConfigurationError?.message || 'email sender unavailable',
      )
      rejected += 1
      continue
    }
    try {
      const result = await withProviderTimeout(
        sender({
          from: claim.sender,
          to: claim.recipient,
          subject: claim.subject,
          text: claim.body_text,
          idempotencyKey: `${MISSED_CALL_EMAIL_IDEMPOTENCY_PREFIX}${claim.call_sid}`,
        }),
      )
      if (result.error || !result.id) {
        const details = emailErrorDetails(result.error)
        const outcome = details.definitelyRejected ? 'rejected' : 'unknown'
        await finishEmail(
          params.db,
          claim,
          outcome,
          undefined,
          details.message || 'email provider outcome was missing an ID',
        )
        if (outcome === 'rejected') rejected += 1
        else unknown += 1
        continue
      }
      try {
        await finishEmail(params.db, claim, 'accepted', result.id)
      } catch {
        throw new Error(
          `Email provider accepted ${result.id}; bridge finalization failed. Do not resend.`,
        )
      }
      accepted += 1
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : String(sendError)
      if (/Email provider accepted /.test(message)) throw sendError
      await finishEmail(params.db, claim, 'unknown', undefined, message)
      unknown += 1
    }
  }
  return { accepted, suppressed, rejected, unknown }
}
