import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthInfo } from '@modelcontextprotocol/server'
import { Webhook } from 'standardwebhooks'
import { postVerifiedWebhook } from './events-webhook'

export const MCP_EVENTS_PROTOCOL_VERSION = '2026-07-28'
export const INBOUND_MESSAGE_EVENT = 'conversation.message.received'

type JsonRpcRequest = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  data?: Record<string, unknown>,
) {
  return Response.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  })
}

function parseArguments(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([key]) => key !== 'conversation_id')) {
    throw new Error('arguments_invalid')
  }
  const conversationId = (value as Record<string, unknown>).conversation_id
  if (
    conversationId !== undefined &&
    (typeof conversationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        conversationId,
      ))
  ) {
    throw new Error('arguments_invalid')
  }
  return conversationId ? { conversation_id: conversationId } : {}
}

function parseDelivery(value: unknown, requireSecret: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('delivery_invalid')
  }
  const delivery = value as Record<string, unknown>
  if (delivery.mode !== 'webhook' || typeof delivery.url !== 'string') {
    throw new Error('delivery_invalid')
  }
  const secret = delivery.secret
  if (requireSecret) {
    if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
      throw new Error('secret_invalid')
    }
    const decoded = Buffer.from(secret.slice(6), 'base64')
    if (decoded.length < 24 || decoded.length > 64) {
      throw new Error('secret_invalid')
    }
  }
  return {
    url: delivery.url,
    secret: typeof secret === 'string' ? secret : null,
  }
}

function subscriptionId(params: {
  owner: string
  name: string
  arguments: Record<string, unknown>
  callbackUrl: string
}) {
  return `sub_${digest(
    canonicalJson({
      owner: params.owner,
      name: params.name,
      arguments: params.arguments,
      callback_url: params.callbackUrl,
    }),
  ).slice(0, 32)}`
}

export function isMcpEventsMethod(method: unknown) {
  return (
    method === 'server/discover' ||
    method === 'events/list' ||
    method === 'events/subscribe' ||
    method === 'events/unsubscribe'
  )
}

export async function handleMcpEventsRequest(params: {
  request: JsonRpcRequest
  authorization: AuthInfo
  supabase: SupabaseClient
  postWebhook?: typeof postVerifiedWebhook
}) {
  const { request, authorization, supabase } = params
  const owner = String(authorization.extra?.subject || '')
  if (!owner) return jsonRpcError(request.id, -32001, 'Unauthorized')

  if (request.method === 'server/discover') {
    return jsonResult(request.id, {
      resultType: 'complete',
      supportedVersions: [MCP_EVENTS_PROTOCOL_VERSION],
      capabilities: { tools: {}, events: {} },
    })
  }

  if (request.method === 'events/list') {
    return jsonResult(request.id, {
      events: [
        {
          name: INBOUND_MESSAGE_EVENT,
          description:
            'A customer SMS or MMS was durably stored in a Sasquatch Sightings conversation. This is an alert, not permission to reply or mutate a record; use get_conversation for owner-authorized context.',
          delivery: ['webhook'],
          inputSchema: {
            type: 'object',
            properties: {
              conversation_id: {
                type: 'string',
                format: 'uuid',
                description:
                  'Optional conversation to monitor. Omit to monitor all owner-visible inbound conversations.',
              },
            },
            additionalProperties: false,
          },
          payloadSchema: {
            type: 'object',
            properties: {
              conversation_id: { type: 'string', format: 'uuid' },
              message_id: { type: 'string' },
              received_at: { type: 'string', format: 'date-time' },
              channel: { type: 'string', enum: ['sms', 'mms'] },
            },
            required: [
              'conversation_id',
              'message_id',
              'received_at',
              'channel',
            ],
            additionalProperties: false,
          },
        },
      ],
      nextCursor: null,
    })
  }

  const requestParams =
    request.params && typeof request.params === 'object'
      ? (request.params as Record<string, unknown>)
      : {}
  if (requestParams.name !== INBOUND_MESSAGE_EVENT) {
    return jsonRpcError(request.id, -32602, 'Invalid event name')
  }

  try {
    const args = parseArguments(requestParams.arguments)
    const delivery = parseDelivery(
      requestParams.delivery,
      request.method === 'events/subscribe',
    )
    const id = subscriptionId({
      owner,
      name: INBOUND_MESSAGE_EVENT,
      arguments: args,
      callbackUrl: delivery.url,
    })

    if (request.method === 'events/unsubscribe') {
      const { error } = await supabase
        .from('mcp_event_subscriptions')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_user_id', owner)
      if (error) throw error
      return jsonResult(request.id, {})
    }

    const { data: existing, error: existingError } = await supabase
      .from('mcp_event_subscriptions')
      .select(
        'callback_secret, status, verified_at, expires_at, previous_callback_secret, secret_rotated_at',
      )
      .eq('id', id)
      .eq('owner_user_id', owner)
      .maybeSingle()
    if (existingError) throw existingError

    const verificationIsFresh =
      existing?.status === 'active' &&
      existing.callback_secret === delivery.secret &&
      new Date(existing.verified_at).getTime() >= Date.now() - 15 * 60 * 1000 &&
      (!existing.expires_at ||
        new Date(existing.expires_at).getTime() > Date.now())

    if (!verificationIsFresh) {
      const challenge = randomBytes(32).toString('base64url')
      const verificationId = `msg_${randomBytes(16).toString('hex')}`
      const body = JSON.stringify({ type: 'verification', challenge })
      const signedAt = new Date()
      const signer = new Webhook(delivery.secret!)
      const post = params.postWebhook ?? postVerifiedWebhook
      let verification
      try {
        verification = await post({
          url: delivery.url,
          body,
          headers: {
            'Content-Type': 'application/json',
            'webhook-id': verificationId,
            'webhook-timestamp': String(Math.floor(signedAt.getTime() / 1000)),
            'webhook-signature': signer.sign(verificationId, signedAt, body),
            'X-MCP-Subscription-Id': id,
          },
        })
      } catch (error) {
        return jsonRpcError(request.id, -32015, 'CallbackEndpointError', {
          reason: error instanceof Error ? error.message : 'connection_failed',
        })
      }
      let returnedChallenge = ''
      try {
        returnedChallenge = String(
          JSON.parse(verification.body).challenge || '',
        )
      } catch {
        // Report the categorized callback error below.
      }
      const expected = Buffer.from(challenge)
      const actual = Buffer.from(returnedChallenge)
      if (
        verification.status < 200 ||
        verification.status >= 300 ||
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        return jsonRpcError(request.id, -32015, 'CallbackEndpointError', {
          reason: 'challenge_failed',
        })
      }
    }

    const requestedTtl = requestParams.ttlMs
    const maximumTtl = 7 * 24 * 60 * 60 * 1000
    const ttl =
      typeof requestedTtl === 'number' && Number.isFinite(requestedTtl)
        ? Math.max(15 * 60 * 1000, Math.min(maximumTtl, requestedTtl))
        : maximumTtl
    const refreshBefore = new Date(Date.now() + ttl).toISOString()
    const { error } = await supabase.from('mcp_event_subscriptions').upsert(
      {
        id,
        owner_user_id: owner,
        event_name: INBOUND_MESSAGE_EVENT,
        arguments: args,
        arguments_hash: digest(canonicalJson(args)),
        callback_url: delivery.url,
        callback_secret: delivery.secret,
        previous_callback_secret:
          existing?.callback_secret &&
          existing.callback_secret !== delivery.secret
            ? existing.callback_secret
            : existing?.previous_callback_secret || null,
        secret_rotated_at:
          existing?.callback_secret &&
          existing.callback_secret !== delivery.secret
            ? new Date().toISOString()
            : existing?.secret_rotated_at || null,
        status: 'active',
        verified_at: verificationIsFresh
          ? existing.verified_at
          : new Date().toISOString(),
        expires_at: refreshBefore,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    return jsonResult(request.id, {
      id,
      refreshBefore,
      cursor: null,
      truncated: false,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid_request'
    if (
      ['arguments_invalid', 'delivery_invalid', 'secret_invalid'].includes(
        reason,
      )
    ) {
      return jsonRpcError(request.id, -32602, 'Invalid params', { reason })
    }
    console.error('[mcp-events] request failed:', error)
    return jsonRpcError(request.id, -32603, 'Internal error')
  }
}

export const canonicalMcpEventArguments = canonicalJson
