// @vitest-environment node
// In-memory database only: no credentials, production clients or network calls.
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  deliverInboundMessageNow,
  deliverPendingMcpEvents,
  enqueuePersistedInboundEvents,
} from './inbound-events'

type Row = Record<string, any>
const sid = 'SM-test-lead'
const eventId = `sms_${createHash('sha256').update(sid).digest('hex').slice(0, 32)}`

function database() {
  const subscription = {
    id: 'sub-test',
    event_name: 'conversation.message.received',
    status: 'active',
    owner_user_id: 'owner',
    arguments: {},
    expires_at: null,
    callback_url: 'https://example.com/events',
    callback_secret: `whsec_${Buffer.alloc(32, 7).toString('base64')}`,
  }
  const tables: Record<string, Row[]> = {
    mcp_inbound_event_ledger: [
      {
        message_sid: sid,
        conversation_id: 'conversation',
        status: 'persisted',
        received_at: new Date().toISOString(),
        event_enqueued_at: null,
        event_payload: { conversation_id: 'conversation', message_id: sid },
      },
      {
        message_sid: 'SM-unrelated',
        conversation_id: 'other',
        status: 'persisted',
        received_at: new Date().toISOString(),
        event_enqueued_at: null,
        event_payload: { conversation_id: 'other', message_id: 'SM-unrelated' },
      },
    ],
    mcp_event_subscriptions: [subscription],
    mcp_event_deliveries: [],
    mcp_authorized_users: [
      { user_id: 'owner', scopes: ['business:read'], revoked_at: null },
    ],
    staff_users: [
      { id: 'staff', user_id: 'owner', role: 'owner', is_active: true },
    ],
  }
  const upsertOptions: Row[] = []
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | undefined
    let single = false
    const query: any = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (key: string, value: unknown) => {
        filters.push((r) => r[key] === value)
        return query
      },
      is: (key: string, value: unknown) => {
        filters.push((r) => r[key] === value)
        return query
      },
      in: (key: string, values: unknown[]) => {
        filters.push((r) => values.includes(r[key]))
        return query
      },
      lte: (key: string, value: string) => {
        filters.push((r) => r[key] <= value)
        return query
      },
      or: () => query,
      update: (value: Row) => {
        patch = value
        return query
      },
      maybeSingle: () => {
        single = true
        return query
      },
      upsert: async (rows: Row[], options: Row) => {
        upsertOptions.push(options)
        for (const row of rows) {
          const existing = tables[table].find((r) => r.id === row.id)
          if (!existing)
            tables[table].push({
              status: 'pending',
              attempts: 0,
              next_attempt_at: new Date().toISOString(),
              ...row,
              mcp_event_subscriptions: subscription,
            })
          else if (!options.ignoreDuplicates) Object.assign(existing, row)
        }
        return { error: null }
      },
      then: (resolve: (value: unknown) => unknown) => {
        const matches = tables[table].filter((row) =>
          filters.every((f) => f(row)),
        )
        if (patch) matches.forEach((row) => Object.assign(row, patch))
        const copies = matches.map((row) => structuredClone(row))
        return Promise.resolve({
          data: single ? (copies[0] ?? null) : copies,
          error: null,
        }).then(resolve)
      },
    }
    return query
  }
  return { client: { from } as never, tables, upsertOptions }
}

const successfulPost = () =>
  vi.fn().mockResolvedValue({ status: 200, body: '' })

describe('immediate LSA event delivery', () => {
  it('does not send without a persisted message or matching subscription', async () => {
    const db = database()
    const postWebhook = successfulPost()
    await deliverInboundMessageNow({
      supabase: db.client,
      messageSid: 'SM-missing',
      postWebhook,
    })
    expect(postWebhook).not.toHaveBeenCalled()
    db.tables.mcp_event_subscriptions = []
    await deliverInboundMessageNow({
      supabase: db.client,
      messageSid: sid,
      postWebhook,
    })
    expect(postWebhook).not.toHaveBeenCalled()
    expect(db.tables.mcp_event_deliveries).toHaveLength(0)
  })

  it('delivers only the current persisted message through the existing subscription', async () => {
    const db = database()
    const postWebhook = successfulPost()
    expect(
      await deliverInboundMessageNow({
        supabase: db.client,
        messageSid: sid,
        postWebhook,
      }),
    ).toBe(1)
    expect(postWebhook).toHaveBeenCalledOnce()
    expect(JSON.parse(postWebhook.mock.calls[0][0].body)).toMatchObject({
      eventId,
      name: 'conversation.message.received',
      data: { message_id: sid },
    })
    expect(db.tables.mcp_event_deliveries).toHaveLength(1)
    expect(db.tables.mcp_event_deliveries[0]).toMatchObject({
      status: 'delivered',
      attempts: 1,
    })
    expect(db.tables.mcp_inbound_event_ledger[1].event_enqueued_at).toBeNull()
  })

  it('preserves delivered rows when cron and the fast path enqueue the same event', async () => {
    const db = database()
    const postWebhook = successfulPost()
    await deliverInboundMessageNow({
      supabase: db.client,
      messageSid: sid,
      postWebhook,
    })
    db.tables.mcp_inbound_event_ledger[0].event_enqueued_at = null
    await deliverInboundMessageNow({
      supabase: db.client,
      messageSid: sid,
      postWebhook,
    })
    expect(db.upsertOptions).toEqual([
      { onConflict: 'subscription_id,event_id', ignoreDuplicates: true },
      { onConflict: 'subscription_id,event_id', ignoreDuplicates: true },
    ])
    expect(postWebhook).toHaveBeenCalledOnce()
    expect(db.tables.mcp_event_deliveries[0].status).toBe('delivered')
  })

  it('allows only one concurrent delivery claimant', async () => {
    const db = database()
    await enqueuePersistedInboundEvents(db.client, sid)
    const postWebhook = successfulPost()
    await Promise.all([
      deliverPendingMcpEvents({
        supabase: db.client,
        messageSid: sid,
        postWebhook,
      }),
      deliverPendingMcpEvents({
        supabase: db.client,
        messageSid: sid,
        postWebhook,
      }),
    ])
    expect(postWebhook).toHaveBeenCalledOnce()
  })

  it('retains failed delivery for cron and respects retry time', async () => {
    const db = database()
    const postWebhook = vi.fn().mockRejectedValue(new Error('timeout'))
    expect(
      await deliverInboundMessageNow({
        supabase: db.client,
        messageSid: sid,
        postWebhook,
      }),
    ).toBe(0)
    const row = db.tables.mcp_event_deliveries[0]
    expect(row).toMatchObject({ status: 'failed', attempts: 1 })
    await deliverPendingMcpEvents({
      supabase: db.client,
      messageSid: sid,
      postWebhook,
    })
    expect(postWebhook).toHaveBeenCalledOnce()
    row.next_attempt_at = new Date(0).toISOString()
    postWebhook.mockResolvedValue({ status: 200, body: '' })
    expect(
      await deliverPendingMcpEvents({ supabase: db.client, postWebhook }),
    ).toBe(1)
    expect(row.status).toBe('delivered')
    expect(
      postWebhook.mock.calls.map((call) => JSON.parse(call[0].body).eventId),
    ).toEqual([eventId, eventId])
  })

  it('does not send without an authorized owner', async () => {
    const db = database()
    db.tables.staff_users = []
    const postWebhook = successfulPost()
    await deliverInboundMessageNow({
      supabase: db.client,
      messageSid: sid,
      postWebhook,
    })
    expect(postWebhook).not.toHaveBeenCalled()
    expect(db.tables.mcp_event_deliveries[0].last_error).toBe(
      'owner_unauthorized',
    )
  })
})
