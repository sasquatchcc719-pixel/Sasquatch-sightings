import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Webhook } from 'standardwebhooks'
import { INBOUND_MESSAGE_EVENT } from './events'
import { postVerifiedWebhook } from './events-webhook'
import { MCP_BUSINESS_SCOPE } from './constants'

function eventId(messageSid: string) {
  return `sms_${createHash('sha256').update(messageSid).digest('hex').slice(0, 32)}`
}

export async function claimInboundMessage(
  supabase: SupabaseClient,
  messageSid: string,
) {
  const now = new Date().toISOString()
  const { error } = await supabase.from('mcp_inbound_event_ledger').insert({
    message_sid: messageSid,
    status: 'processing',
    claimed_at: now,
    received_at: now,
  })
  if (!error) return true
  if (error.code !== '23505') throw error
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { data, error: reclaimError } = await supabase
    .from('mcp_inbound_event_ledger')
    .update({ status: 'processing', claimed_at: now, last_error: null })
    .eq('message_sid', messageSid)
    .or(
      `status.eq.failed,and(status.eq.processing,claimed_at.lt.${staleBefore})`,
    )
    .select('message_sid')
    .maybeSingle()
  if (reclaimError) throw reclaimError
  return Boolean(data)
}

export async function markInboundMessageFailed(
  supabase: SupabaseClient,
  messageSid: string,
  error: unknown,
) {
  await supabase
    .from('mcp_inbound_event_ledger')
    .update({
      status: 'failed',
      last_error: String(error instanceof Error ? error.message : error).slice(
        0,
        1000,
      ),
    })
    .eq('message_sid', messageSid)
}

export async function markInboundMessagePersisted(params: {
  supabase: SupabaseClient
  messageSid: string
  conversationId: string
  receivedAt: string
  hasMedia: boolean
}) {
  const { error } = await params.supabase
    .from('mcp_inbound_event_ledger')
    .update({
      status: 'persisted',
      conversation_id: params.conversationId,
      persisted_at: new Date().toISOString(),
      event_payload: {
        conversation_id: params.conversationId,
        message_id: params.messageSid,
        received_at: params.receivedAt,
        channel: params.hasMedia ? 'mms' : 'sms',
      },
      last_error: null,
    })
    .eq('message_sid', params.messageSid)
  if (error) throw error
}

export async function markInboundMessageDuplicate(params: {
  supabase: SupabaseClient
  messageSid: string
  conversationId: string
}) {
  const now = new Date().toISOString()
  const { error } = await params.supabase
    .from('mcp_inbound_event_ledger')
    .update({
      status: 'persisted',
      conversation_id: params.conversationId,
      persisted_at: now,
      event_enqueued_at: now,
      event_payload: null,
      last_error: 'legacy_duplicate_suppressed',
    })
    .eq('message_sid', params.messageSid)
  if (error) throw error
}

export async function enqueuePersistedInboundEvents(supabase: SupabaseClient) {
  const { data: ledger, error } = await supabase
    .from('mcp_inbound_event_ledger')
    .select('message_sid, conversation_id, received_at, event_payload')
    .eq('status', 'persisted')
    .is('event_enqueued_at', null)
    .order('persisted_at', { ascending: true })
    .limit(50)
  if (error) throw error

  let enqueued = 0
  for (const entry of ledger || []) {
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('mcp_event_subscriptions')
      .select('id, arguments')
      .eq('event_name', INBOUND_MESSAGE_EVENT)
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    if (subscriptionError) throw subscriptionError

    const matching = (subscriptions || []).filter((subscription) => {
      const filter = subscription.arguments as {
        conversation_id?: string
      } | null
      return (
        !filter?.conversation_id ||
        filter.conversation_id === entry.conversation_id
      )
    })
    if (matching.length > 0) {
      const baseEventId = eventId(entry.message_sid)
      const rows = matching.map((subscription) => ({
        id: `evt_${createHash('sha256')
          .update(`${subscription.id}:${baseEventId}`)
          .digest('hex')
          .slice(0, 40)}`,
        subscription_id: subscription.id,
        event_id: baseEventId,
        event_name: INBOUND_MESSAGE_EVENT,
        occurred_at: entry.received_at,
        payload: entry.event_payload,
      }))
      const { error: deliveryError } = await supabase
        .from('mcp_event_deliveries')
        .upsert(rows, { onConflict: 'subscription_id,event_id' })
      if (deliveryError) throw deliveryError
      enqueued += rows.length
    }
    const { error: markError } = await supabase
      .from('mcp_inbound_event_ledger')
      .update({ event_enqueued_at: new Date().toISOString() })
      .eq('message_sid', entry.message_sid)
      .is('event_enqueued_at', null)
    if (markError) throw markError
  }
  return enqueued
}

export async function deliverPendingMcpEvents(params: {
  supabase: SupabaseClient
  postWebhook?: typeof postVerifiedWebhook
}) {
  const now = new Date().toISOString()
  const { data: deliveries, error } = await params.supabase
    .from('mcp_event_deliveries')
    .select(
      'id, event_id, event_name, occurred_at, payload, attempts, mcp_event_subscriptions!inner(id, owner_user_id, callback_url, callback_secret, previous_callback_secret, secret_rotated_at, status, expires_at)',
    )
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(20)
  if (error) throw error

  let delivered = 0
  const authorizedOwners = new Map<string, boolean>()
  for (const delivery of deliveries || []) {
    const subscription = Array.isArray(delivery.mcp_event_subscriptions)
      ? delivery.mcp_event_subscriptions[0]
      : delivery.mcp_event_subscriptions
    if (
      !subscription ||
      subscription.status !== 'active' ||
      (subscription.expires_at && subscription.expires_at <= now)
    ) {
      await params.supabase
        .from('mcp_event_deliveries')
        .update({ status: 'discarded', last_error: 'subscription_inactive' })
        .eq('id', delivery.id)
      continue
    }

    let ownerAuthorized = authorizedOwners.get(subscription.owner_user_id)
    if (ownerAuthorized === undefined) {
      const [
        { data: grant, error: grantError },
        { data: owner, error: ownerError },
      ] = await Promise.all([
        params.supabase
          .from('mcp_authorized_users')
          .select('scopes')
          .eq('user_id', subscription.owner_user_id)
          .is('revoked_at', null)
          .maybeSingle(),
        params.supabase
          .from('staff_users')
          .select('id')
          .eq('user_id', subscription.owner_user_id)
          .eq('role', 'owner')
          .eq('is_active', true)
          .maybeSingle(),
      ])
      if (grantError) throw grantError
      if (ownerError) throw ownerError
      ownerAuthorized =
        Boolean(owner) &&
        Array.isArray(grant?.scopes) &&
        grant.scopes.includes(MCP_BUSINESS_SCOPE)
      authorizedOwners.set(subscription.owner_user_id, ownerAuthorized)
    }
    if (!ownerAuthorized) {
      await Promise.all([
        params.supabase
          .from('mcp_event_deliveries')
          .update({ status: 'discarded', last_error: 'owner_unauthorized' })
          .eq('id', delivery.id),
        params.supabase
          .from('mcp_event_subscriptions')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .eq('id', subscription.id),
      ])
      continue
    }

    const attempt = Number(delivery.attempts || 0) + 1
    const { data: claimed } = await params.supabase
      .from('mcp_event_deliveries')
      .update({ status: 'delivering', attempts: attempt, last_attempt_at: now })
      .eq('id', delivery.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const event = {
      eventId: delivery.event_id,
      name: delivery.event_name,
      timestamp: delivery.occurred_at,
      data: delivery.payload,
      cursor: null,
    }
    const body = JSON.stringify(event)
    if (Buffer.byteLength(body, 'utf8') > 256 * 1024) {
      await params.supabase
        .from('mcp_event_deliveries')
        .update({ status: 'discarded', last_error: 'payload_too_large' })
        .eq('id', delivery.id)
      continue
    }
    const signedAt = new Date()
    const signer = new Webhook(subscription.callback_secret)
    const signatures = [signer.sign(delivery.event_id, signedAt, body)]
    if (
      subscription.previous_callback_secret &&
      subscription.secret_rotated_at &&
      new Date(subscription.secret_rotated_at).getTime() >=
        Date.now() - 5 * 60 * 1000
    ) {
      signatures.push(
        new Webhook(subscription.previous_callback_secret).sign(
          delivery.event_id,
          signedAt,
          body,
        ),
      )
    }
    try {
      const post = params.postWebhook ?? postVerifiedWebhook
      const response = await post({
        url: subscription.callback_url,
        body,
        headers: {
          'Content-Type': 'application/json',
          'webhook-id': delivery.event_id,
          'webhook-timestamp': String(Math.floor(signedAt.getTime() / 1000)),
          'webhook-signature': signatures.join(' '),
          'X-MCP-Subscription-Id': subscription.id,
        },
      })
      if (response.status >= 200 && response.status < 300) {
        await params.supabase
          .from('mcp_event_deliveries')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            response_status: response.status,
            last_error: null,
          })
          .eq('id', delivery.id)
        delivered += 1
      } else {
        const terminal = response.status === 410 || response.status === 413
        const exhausted = attempt >= 8
        await params.supabase
          .from('mcp_event_deliveries')
          .update({
            status: terminal || exhausted ? 'discarded' : 'failed',
            response_status: response.status,
            last_error: `http_${response.status}`,
            next_attempt_at: new Date(
              Date.now() + Math.min(60 * 60_000, 2 ** attempt * 30_000),
            ).toISOString(),
          })
          .eq('id', delivery.id)
      }
    } catch (deliveryError) {
      await params.supabase
        .from('mcp_event_deliveries')
        .update({
          status: attempt >= 8 ? 'discarded' : 'failed',
          last_error: String(
            deliveryError instanceof Error
              ? deliveryError.message
              : deliveryError,
          ).slice(0, 1000),
          next_attempt_at: new Date(
            Date.now() + Math.min(60 * 60_000, 2 ** attempt * 30_000),
          ).toISOString(),
        })
        .eq('id', delivery.id)
    }
  }
  return delivered
}
