// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
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
  return { client: { from } as never, from, upsert }
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
    const postWebhook = vi.fn(async ({ body }: { body: string }) => ({
      status: 200,
      body: JSON.stringify({ challenge: JSON.parse(body).challenge }),
    }))
    const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`
    const response = await handleMcpEventsRequest({
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'events/subscribe',
        params: {
          name: INBOUND_MESSAGE_EVENT,
          arguments: {},
          delivery: {
            mode: 'webhook',
            url: 'https://events.example.com/mcp',
            secret,
          },
          ttlMs: 3_600_000,
        },
      },
      authorization,
      supabase: db.client,
      postWebhook: postWebhook as never,
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
  })

  it('does not persist a subscription when callback verification fails', async () => {
    const db = database()
    const secret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`
    const response = await handleMcpEventsRequest({
      request: {
        id: 4,
        method: 'events/subscribe',
        params: {
          name: INBOUND_MESSAGE_EVENT,
          arguments: {},
          delivery: {
            mode: 'webhook',
            url: 'https://events.example.com/mcp',
            secret,
          },
        },
      },
      authorization,
      supabase: db.client,
      postWebhook: vi.fn().mockResolvedValue({
        status: 200,
        body: JSON.stringify({ challenge: 'wrong' }),
      }),
    })
    const payload = await response.json()

    expect(payload.error).toMatchObject({
      code: -32015,
      message: 'CallbackEndpointError',
    })
    expect(db.upsert).not.toHaveBeenCalled()
  })
})
