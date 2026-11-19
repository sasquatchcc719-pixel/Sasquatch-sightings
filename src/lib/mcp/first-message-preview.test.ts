// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { previewConversationSend } from './business-operations'
const customer = '20000000-0000-4000-8000-000000000001'
const lead = '30000000-0000-4000-8000-000000000001'
const actor = {
  subject: '10000000-0000-4000-8000-000000000001',
  label: 'Owner',
  scopes: ['business:read', 'customer:contact'],
}
function fixture(
  existing = false,
  options: {
    savedCustomer?: boolean
    leadMatches?: Array<Record<string, unknown>>
  } = {},
) {
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
        in() {
          return q
        },
        order() {
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
              table === 'conversations' && existing
                ? { id: 'existing' }
                : table === 'ops_customers' && options.savedCustomer
                  ? { id: customer }
                  : null,
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
                : table === 'leads'
                  ? {
                      id: lead,
                      name: 'Fixture Lead',
                      phone: '(719) 555-0100',
                      source: 'website',
                      status: 'new',
                      created_at: '2026-11-19T00:55:00Z',
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
        then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
          onfulfilled?:
            | ((value: {
                data: unknown
                error: null
              }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ) {
          return Promise.resolve({
            data: table === 'leads' ? options.leadMatches || [] : [],
            error: null,
          }).then(onfulfilled, onrejected)
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
  it('binds a verified new lead and exact recipient without creating a preview-time shell', async () => {
    const f = fixture()
    const result = await previewConversationSend(
      {
        lead_id: lead,
        body: 'Exact lead scheduling question',
        media_ids: [],
        idempotency_key: 'owner-approved-lead-first',
      },
      actor,
      f.db as never,
    )
    expect(result.preview).toMatchObject({
      action: 'Send first lead SMS',
      lead_id: lead,
      lead_source: 'website',
      to: '+17195550100',
      body: 'Exact lead scheduling question',
    })
    expect(f.payload?.action_payload).toMatchObject({
      first_contact: {
        lead_id: lead,
        phone: '+17195550100',
        lead_created_at: '2026-11-19T00:55:00Z',
        lead_source: 'website',
        lead_status: 'new',
      },
    })
    expect(f.conversationWrites).toBe(0)
  })
  it('previews an exact owner handoff without creating a lead or conversation early', async () => {
    const f = fixture()
    const result = await previewConversationSend(
      {
        lead_intake: {
          phone: '(719) 555-0100',
          name: 'Synthetic New Lead',
        },
        body: 'Exact owner-approved introduction',
        media_ids: [],
        idempotency_key: 'owner-approved-intake-first',
      },
      actor,
      f.db as never,
    )
    expect(result.preview).toMatchObject({
      action: 'Create lead and send first SMS',
      lead_intake: {
        name: 'Synthetic New Lead',
        source: 'owner_handoff',
      },
      to: '+17195550100',
      body: 'Exact owner-approved introduction',
    })
    expect(f.payload?.action_payload).toMatchObject({
      first_contact: {
        new_lead: {
          phone: '+17195550100',
          name: 'Synthetic New Lead',
          source: 'owner_handoff',
        },
        phone: '+17195550100',
      },
    })
    expect(f.conversationWrites).toBe(0)
  })
  it('resolves one matching lead instead of creating a duplicate intake record', async () => {
    const f = fixture(false, {
      leadMatches: [
        {
          id: lead,
          name: 'Fixture Lead',
          phone: '+17195550100',
          source: 'website',
          status: 'new',
          created_at: '2026-11-19T00:55:00Z',
        },
      ],
    })
    const result = await previewConversationSend(
      {
        lead_intake: { phone: '+17195550100' },
        body: 'Exact scheduling question',
        media_ids: [],
        idempotency_key: 'owner-approved-resolved-lead',
      },
      actor,
      f.db as never,
    )
    expect(result.preview).toMatchObject({
      action: 'Send first lead SMS',
      lead_id: lead,
      to: '+17195550100',
    })
    expect(f.payload?.action_payload).toMatchObject({
      first_contact: { lead_id: lead },
    })
  })
  it('requires one verified identity and forbids cross-conversation attachments', async () => {
    const f = fixture()
    for (const input of [
      {},
      { customer_id: customer, conversation_id: customer },
      { customer_id: customer, lead_id: lead },
      {
        customer_id: customer,
        lead_intake: { phone: '+17195550100' },
      },
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
  it('refuses a lead phone already owned by a saved customer', async () => {
    const f = fixture(false, { savedCustomer: true })
    await expect(
      previewConversationSend(
        {
          lead_id: lead,
          body: 'Question',
          media_ids: [],
          idempotency_key: 'owner-approved-lead-first',
        },
        actor,
        f.db as never,
      ),
    ).rejects.toThrow('Saved customer')
    expect(f.payload).toBeNull()
  })
  it('refuses ambiguous matching leads during owner intake', async () => {
    const f = fixture(false, {
      leadMatches: [
        { id: lead, status: 'new' },
        { id: '30000000-0000-4000-8000-000000000002', status: 'new' },
      ],
    })
    await expect(
      previewConversationSend(
        {
          lead_intake: { phone: '+17195550100' },
          body: 'Question',
          media_ids: [],
          idempotency_key: 'owner-approved-ambiguous-lead',
        },
        actor,
        f.db as never,
      ),
    ).rejects.toThrow('Multiple leads')
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
