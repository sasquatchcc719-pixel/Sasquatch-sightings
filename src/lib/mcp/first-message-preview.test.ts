// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { previewConversationSend } from './business-operations'
const customer = '20000000-0000-4000-8000-000000000001'
const actor = {
  subject: '10000000-0000-4000-8000-000000000001',
  label: 'Owner',
  scopes: ['business:read', 'customer:contact'],
}
function fixture(existing = false) {
  let payload: Record<string, any> | null = null
  let conversationWrites = 0
  const db = {
    from(table: string) {
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        or() {
          return q
        },
        limit() {
          return q
        },
        lt() {
          return q
        },
        update() {
          if (table === 'conversations') conversationWrites++
          return q
        },
        insert(v: Record<string, unknown>) {
          payload = v
          if (table === 'conversations') conversationWrites++
          return q
        },
        async maybeSingle() {
          return {
            data:
              table === 'conversations' && existing ? { id: 'existing' } : null,
            error: null,
          }
        },
        async single() {
          return {
            data:
              table === 'ops_customers'
                ? {
                    id: customer,
                    full_name: 'Fixture Customer',
                    phone: '+17195550100',
                    updated_at: '2026-10-26T12:00:00Z',
                    is_internal: false,
                  }
                : {
                    id: 'preview',
                    preview: payload?.preview,
                    status: 'pending',
                    expires_at: 'later',
                  },
            error: null,
          }
        },
      }
      return q
    },
  }
  return {
    db,
    get payload() {
      return payload
    },
    get conversationWrites() {
      return conversationWrites
    },
  }
}
describe('first-message preview identity', () => {
  it('binds customer, current phone, exact body and version without fictional conversation writes', async () => {
    const f = fixture()
    const result = await previewConversationSend(
      {
        customer_id: customer,
        body: 'Exact scheduling question',
        media_ids: [],
        idempotency_key: 'owner-approved-first',
      },
      actor,
      f.db as never,
    )
    expect(result.preview).toMatchObject({
      customer_id: customer,
      to: '+17195550100',
      body: 'Exact scheduling question',
    })
    expect(f.payload?.action_payload).toMatchObject({
      first_contact: {
        customer_id: customer,
        phone: '+17195550100',
        customer_updated_at: '2026-10-26T12:00:00Z',
      },
    })
    expect(f.conversationWrites).toBe(0)
  })
  it('requires one verified identity and forbids cross-conversation attachments', async () => {
    const f = fixture()
    for (const input of [
      {},
      { customer_id: customer, conversation_id: customer },
      { customer_id: customer, media_ids: ['unrelated-media'] },
    ])
      await expect(
        previewConversationSend(
          {
            body: 'Question',
            media_ids: [],
            idempotency_key: 'owner-approved-first',
            ...input,
          },
          actor,
          f.db as never,
        ),
      ).rejects.toThrow()
    expect(f.payload).toBeNull()
  })
  it('refuses to silently replace an existing conversation or omit contact permission', async () => {
    const f = fixture(true)
    await expect(
      previewConversationSend(
        {
          customer_id: customer,
          body: 'Question',
          media_ids: [],
          idempotency_key: 'owner-approved-first',
        },
        actor,
        f.db as never,
      ),
    ).rejects.toThrow('Existing conversation')
    await expect(
      previewConversationSend(
        {
          customer_id: customer,
          body: 'Question',
          media_ids: [],
          idempotency_key: 'owner-approved-first',
        },
        { ...actor, scopes: ['business:read'] },
        f.db as never,
      ),
    ).rejects.toThrow('customer:contact')
    expect(f.payload).toBeNull()
  })
})
