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

type McpEventDiagnostic = {
  method: string
  phase:
    | 'request_validation'
    | 'subscription_lookup'
    | 'callback_verification'
    | 'subscription_persistence'
  outcome: 'rejected' | 'failed' | 'succeeded'
  reason: string
  callback_host?: string
  callback_status?: number
  duration_ms?: number
  subscription_id?: string
}

type McpEventDiagnosticLogger = (diagnostic: McpEventDiagnostic) => void
type McpEventDiagnosticDetails = Omit<
  McpEventDiagnostic,
  'method' | 'callback_host' | 'subscription_id'
>

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

function callbackHost(value: unknown) {
  if (typeof value !== 'string') return undefined
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

function callbackFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (
    ['callback_invalid', 'callback_not_public', 'callback_timeout'].includes(
      message,
    )
  ) {
    return message
  }

  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : ''
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'callback_dns_error'
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
    return 'callback_timeout'
  }
  if (code === 'ECONNREFUSED') return 'callback_connection_refused'
  if (['ECONNRESET', 'EPIPE'].includes(code)) {
    return 'callback_connection_reset'
  }
  if (
    code.startsWith('ERR_TLS_') ||
    code.startsWith('CERT_') ||
    code.includes('CERTIFICATE')
  ) {
    return 'callback_tls_error'
  }
  return 'callback_connection_failed'
}

function defaultDiagnosticLogger(diagnostic: McpEventDiagnostic) {
  console.info('[mcp-events]', JSON.stringify(diagnostic))
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
  logDiagnostic?: McpEventDiagnosticLogger
}) {
  const { request, authorization, supabase } = params
  const logDiagnostic = params.logDiagnostic ?? defaultDiagnosticLogger
  const method = typeof request.method === 'string' ? request.method : 'unknown'
  let phase: McpEventDiagnostic['phase'] = 'request_validation'
  let callbackHostValue: string | undefined
  let subscriptionIdValue: string | undefined
  const diagnose = (details: McpEventDiagnosticDetails) =>
    logDiagnostic({
      method,
      ...details,
      ...(callbackHostValue ? { callback_host: callbackHostValue } : {}),
      ...(subscriptionIdValue ? { subscription_id: subscriptionIdValue } : {}),
    })
  const owner = String(authorization.extra?.subject || '')
  if (!owner) {
    diagnose({
      phase,
      outcome: 'rejected',
      reason: 'owner_missing',
    })
    return jsonRpcError(request.id, -32001, 'Unauthorized')
  }

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
    diagnose({
      phase,
      outcome: 'rejected',
      reason: 'event_name_invalid',
    })
    return jsonRpcError(request.id, -32602, 'Invalid event name', {
      reason: 'event_name_invalid',
    })
  }

  try {
    const args = parseArguments(requestParams.arguments)
    const delivery = parseDelivery(
      requestParams.delivery,
      request.method === 'events/subscribe',
    )
    callbackHostValue = callbackHost(delivery.url)
    const id = subscriptionId({
      owner,
      name: INBOUND_MESSAGE_EVENT,
      arguments: args,
      callbackUrl: delivery.url,
    })
    subscriptionIdValue = id

    if (request.method === 'events/unsubscribe') {
      phase = 'subscription_persistence'
      const { error } = await supabase
        .from('mcp_event_subscriptions')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('owner_user_id', owner)
      if (error) throw error
      diagnose({
        phase,
        outcome: 'succeeded',
        reason: 'subscription_revoked',
      })
      return jsonResult(request.id, {})
    }

    phase = 'subscription_lookup'
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
      phase = 'callback_verification'
      const verificationStartedAt = Date.now()
      const callbackError = (reason: string, status?: number) => {
        diagnose({
          phase,
          outcome: 'failed',
          reason,
          ...(status === undefined ? {} : { callback_status: status }),
          duration_ms: Date.now() - verificationStartedAt,
        })
        return jsonRpcError(request.id, -32015, 'CallbackEndpointError', {
          reason,
          ...(status === undefined ? {} : { status }),
        })
      }
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
        return callbackError(callbackFailureReason(error))
      }
      if (verification.status < 200 || verification.status >= 300) {
        return callbackError('callback_http_error', verification.status)
      }
      let returnedChallenge: unknown
      try {
        returnedChallenge = JSON.parse(verification.body).challenge
      } catch {
        return callbackError('callback_response_invalid', verification.status)
      }
      if (typeof returnedChallenge !== 'string') {
        return callbackError('callback_response_invalid', verification.status)
      }
      const expected = Buffer.from(challenge)
      const actual = Buffer.from(returnedChallenge)
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        return callbackError('challenge_failed', verification.status)
      }
      diagnose({
        phase,
        outcome: 'succeeded',
        reason: 'callback_verified',
        callback_status: verification.status,
        duration_ms: Date.now() - verificationStartedAt,
      })
    }

    const requestedTtl = requestParams.ttlMs
    const maximumTtl = 7 * 24 * 60 * 60 * 1000
    const ttl =
      typeof requestedTtl === 'number' && Number.isFinite(requestedTtl)
        ? Math.max(15 * 60 * 1000, Math.min(maximumTtl, requestedTtl))
        : maximumTtl
    const refreshBefore = new Date(Date.now() + ttl).toISOString()
    phase = 'subscription_persistence'
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
    diagnose({
      phase,
      outcome: 'succeeded',
      reason: 'subscription_active',
    })
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
      diagnose({
        phase,
        outcome: 'rejected',
        reason,
      })
      return jsonRpcError(request.id, -32602, 'Invalid params', { reason })
    }
    diagnose({
      phase,
      outcome: 'failed',
      reason:
        phase === 'subscription_lookup' || phase === 'subscription_persistence'
          ? 'subscription_database_error'
          : 'internal_error',
    })
    return jsonRpcError(request.id, -32603, 'Internal error')
  }
}

export const canonicalMcpEventArguments = canonicalJson
