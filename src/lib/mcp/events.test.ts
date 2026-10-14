// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AuthInfo } from '@modelcontextprotocol/server'
import {
  handleMcpEventsRequest,
  INBOUND_MESSAGE_EVENT,
  MCP_EVENTS_PROTOCOL_VERSION,
} from './events'

const owner = 'f8b5e475-eaee-4b1c-9cf1-e40b7195a22f'
const authorization = {
  token: 'test',
  clientId: 'chatgpt-test',
  scopes: ['business:read'],
  extra: { subject: owner },
} satisfies AuthInfo

function database() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const updateQuery = {
    eq: vi.fn(),
  }
  updateQuery.eq.mockReturnValue(updateQuery)
  const selectQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  selectQuery.eq.mockReturnValue(selectQuery)
  const from = vi.fn(() => ({
    upsert,
    update: vi.fn(() => updateQuery),
    select: vi.fn(() => selectQuery),
  }))
  return { client: { from } as never, from, selectQuery, upsert }
}

function subscribeRequest(secret: string, delivery = {}) {
  return {
    jsonrpc: '2.0',
    id: 3,
    method: 'events/subscribe',
    params: {
      name: INBOUND_MESSAGE_EVENT,
      arguments: {},
      delivery: {
        mode: 'webhook',
        url: 'https://events.example.com/private/callback?token=hidden',
        secret,
        ...delivery,
      },
      ttlMs: 3_600_000,
    },
  }
}

describe('MCP Events protocol extension', () => {
  it('discovers only the supported events protocol', async () => {
    const response = await handleMcpEventsRequest({
      request: { jsonrpc: '2.0', id: 1, method: 'server/discover' },
      authorization,
      supabase: database().client,
    })

    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        resultType: 'complete',
        supportedVersions: [MCP_EVENTS_PROTOCOL_VERSION],
        capabilities: { tools: {}, events: {} },
      },
    })
  })

  it('lists the one read-only inbound-message alert', async () => {
    const response = await handleMcpEventsRequest({
      request: { jsonrpc: '2.0', id: 2, method: 'events/list' },
      authorization,
      supabase: database().client,
    })
    const payload = await response.json()
    expect(payload.result.events).toHaveLength(1)
    expect(payload.result.events[0]).toMatchObject({
      name: INBOUND_MESSAGE_EVENT,
      delivery: ['webhook'],
    })
  })

  it('verifies the callback challenge before persisting an owner-bound subscription', async () => {
    const db = database()
    const logDiagnostic = vi.fn()
    const postWebhook = vi.fn(async ({ body }: { body: string }) => ({
      status: 200,
      body: JSON.stringify({ challenge: JSON.parse(body).challenge }),
    }))
    const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`
    const response = await handleMcpEventsRequest({
      request: subscribeRequest(secret),
      authorization,
      supabase: db.client,
      postWebhook: postWebhook as never,
      logDiagnostic,
    })
    const payload = await response.json()

    expect(payload.result.id).toMatch(/^sub_[0-9a-f]{32}$/)
    expect(postWebhook).toHaveBeenCalledOnce()
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_user_id: owner,
        event_name: INBOUND_MESSAGE_EVENT,
        callback_secret: secret,
        status: 'active',
      }),
      { onConflict: 'id' },
    )
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'callback_verification',
        outcome: 'succeeded',
        reason: 'callback_verified',
        callback_host: 'events.example.com',
        callback_status: 200,
      }),
    )
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'subscription_persistence',
        outcome: 'succeeded',
        reason: 'subscription_active',
      }),
    )
  })

  it('does not persist a subscription when callback verification fails', async () => {
    const db = database()
    const logDiagnostic = vi.fn()
    const secret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`
    const response = await handleMcpEventsRequest({
      request: subscribeRequest(secret),
      authorization,
      supabase: db.client,
      postWebhook: vi.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({ challenge: 'wrong' }),
      }),
      logDiagnostic,
    })
    const payload = await response.json()

    expect(payload.error).toMatchObject({
      code: -32015,
      message: 'CallbackEndpointError',
      data: { reason: 'challenge_failed' },
    })
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'callback_verification',
        outcome: 'failed',
        reason: 'challenge_failed',
        callback_status: 200,
      }),
    )
    expect(db.upsert).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'network timeout',
      postWebhook: vi
        .fn()
        .mockRejectedValue(
          Object.assign(
            new Error(
              'request failed for /private/callback?token=hidden with whsec_hidden',
            ),
            { code: 'ETIMEDOUT' },
          ),
        ),
      expectedData: { reason: 'callback_timeout' },
      expectedDiagnostic: { reason: 'callback_timeout' },
    },
    {
      label: 'DNS failure',
      postWebhook: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }),
        ),
      expectedData: { reason: 'callback_dns_error' },
      expectedDiagnostic: { reason: 'callback_dns_error' },
    },
    {
      label: 'refused connection',
      postWebhook: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' }),
        ),
      expectedData: { reason: 'callback_connection_refused' },
      expectedDiagnostic: { reason: 'callback_connection_refused' },
    },
    {
      label: 'TLS failure',
      postWebhook: vi.fn().mockRejectedValue(
        Object.assign(new Error('certificate failed'), {
          code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        }),
      ),
      expectedData: { reason: 'callback_tls_error' },
      expectedDiagnostic: { reason: 'callback_tls_error' },
    },
    {
      label: 'non-2xx response',
      postWebhook: vi.fn().mockResolvedValue({
        status: 503,
        body: 'upstream body with whsec_hidden',
      }),
      expectedData: { reason: 'callback_http_error', status: 503 },
      expectedDiagnostic: {
        reason: 'callback_http_error',
        callback_status: 503,
      },
    },
    {
      label: 'malformed response',
      postWebhook: vi.fn().mockResolvedValue({
        status: 200,
        body: 'not-json /private/callback?token=hidden whsec_hidden',
      }),
      expectedData: { reason: 'callback_response_invalid' },
      expectedDiagnostic: {
        reason: 'callback_response_invalid',
        callback_status: 200,
      },
    },
  ])(
    'returns and logs a secret-safe category for a $label',
    async ({ postWebhook, expectedData, expectedDiagnostic }) => {
      const db = database()
      const logDiagnostic = vi.fn()
      const secret = `whsec_${Buffer.alloc(32, 11).toString('base64')}`
      const response = await handleMcpEventsRequest({
        request: subscribeRequest(secret),
        authorization,
        supabase: db.client,
        postWebhook,
        logDiagnostic,
      })

      expect(await response.json()).toMatchObject({
        error: {
          code: -32015,
          message: 'CallbackEndpointError',
          data: expectedData,
        },
      })
      expect(logDiagnostic).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'events/subscribe',
          phase: 'callback_verification',
          outcome: 'failed',
          callback_host: 'events.example.com',
          ...expectedDiagnostic,
        }),
      )
      const diagnostics = JSON.stringify(logDiagnostic.mock.calls)
      expect(diagnostics).not.toContain(secret)
      expect(diagnostics).not.toContain('/private/callback')
      expect(diagnostics).not.toContain('token=hidden')
      expect(diagnostics).not.toContain('whsec_hidden')
      expect(db.upsert).not.toHaveBeenCalled()
    },
  )

  it('distinguishes request validation from callback failures', async () => {
    const db = database()
    const logDiagnostic = vi.fn()
    const malformedSecret = `whsec_${Buffer.alloc(32, 5)
      .toString('base64')
      .replace('B', '_')}`
    const response = await handleMcpEventsRequest({
      request: subscribeRequest(malformedSecret),
      authorization,
      supabase: db.client,
      postWebhook: vi.fn(),
      logDiagnostic,
    })

    expect(await response.json()).toMatchObject({
      error: {
        code: -32602,
        message: 'Invalid params',
        data: { reason: 'secret_invalid' },
      },
    })
    expect(logDiagnostic).toHaveBeenCalledWith({
      method: 'events/subscribe',
      phase: 'request_validation',
      outcome: 'rejected',
      reason: 'secret_invalid',
    })
  })

  it('categorizes subscription lookup failures without logging database details', async () => {
    const db = database()
    const logDiagnostic = vi.fn()
    db.selectQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error('database detail that must not be logged'),
    })
    const secret = `whsec_${Buffer.alloc(32, 13).toString('base64')}`
    const response = await handleMcpEventsRequest({
      request: subscribeRequest(secret),
      authorization,
      supabase: db.client,
      postWebhook: vi.fn(),
      logDiagnostic,
    })

    expect(await response.json()).toMatchObject({
      error: { code: -32603, message: 'Internal error' },
    })
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'subscription_lookup',
        outcome: 'failed',
        reason: 'subscription_database_error',
      }),
    )
    expect(JSON.stringify(logDiagnostic.mock.calls)).not.toContain(
      'database detail',
    )
  })
})
