// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  executePreparedAction,
  previewConversationSend,
  previewEstimateDecision,
} from './business-operations'

class PreviewQuery {
  private inserted: Record<string, unknown> | null = null

  constructor(
    private readonly table: string,
    private readonly state: {
      previewInsert: Record<string, unknown> | null
    },
  ) {}

  select() {
    return this
  }
  eq() {
    return this
  }
  in() {
    return this
  }
  lt() {
    return this
  }
  update() {
    return this
  }
  insert(value: Record<string, unknown>) {
    this.inserted = value
    this.state.previewInsert = value
    return this
  }
  maybeSingle() {
    if (this.table === 'conversations') {
      return Promise.resolve({
        data: {
          id: '10000000-0000-4000-8000-000000000001',
          phone_number: '+17195550123',
          ops_customer_id: '20000000-0000-4000-8000-000000000001',
          updated_at: '2026-10-12T20:00:00Z',
        },
        error: null,
      })
    }
    if (this.table === 'telegram_relay_threads') {
      return Promise.resolve({
        data: { business_number: '+17192498791' },
        error: null,
      })
    }
    if (this.table === 'mcp_action_previews') {
      return Promise.resolve({ data: null, error: null })
    }
    if (this.table === 'ops_appointments') {
      return Promise.resolve({
        data: {
          id: '50000000-0000-4000-8000-000000000001',
          kind: 'estimate',
          estimate_status: 'sent',
          converted_appointment_id: null,
          quoted_total: 425,
          updated_at: '2026-10-12T21:00:00Z',
          ops_customers: {
            id: '20000000-0000-4000-8000-000000000001',
            full_name: 'Test Customer',
            business_name: null,
          },
          ops_service_addresses: {
            street_1: '123 Main St',
            city: 'Colorado Springs',
            state: 'CO',
            zip_code: '80903',
          },
        },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  }
  single() {
    if (this.table !== 'mcp_action_previews' || !this.inserted) {
      throw new Error('Unexpected single()')
    }
    return Promise.resolve({
      data: {
        id: '30000000-0000-4000-8000-000000000001',
        preview: this.inserted.preview,
        status: 'pending',
        expires_at: this.inserted.expires_at,
      },
      error: null,
    })
  }
}

function fixture() {
  const state = { previewInsert: null as Record<string, unknown> | null }
  return {
    state,
    client: {
      from(table: string) {
        return new PreviewQuery(table, state)
      },
    },
  }
}

describe('MCP confirmed operation previews', () => {
  it('stores the exact recipient, retained sender, body, scope, and stale-record guard', async () => {
    const { client, state } = fixture()

    const result = await previewConversationSend(
      {
        conversation_id: '10000000-0000-4000-8000-000000000001',
        body: 'We can be there Tuesday.',
        media_ids: [],
        idempotency_key: 'send-customer-1234',
      },
      {
        subject: '40000000-0000-4000-8000-000000000001',
        label: 'Charles',
        scopes: ['business:read', 'customer:contact'],
      },
      client as never,
    )

    expect(result.preview).toMatchObject({
      action: 'Send customer SMS',
      to: '+17195550123',
      from: '+17192498791',
      body: 'We can be there Tuesday.',
    })
    expect(state.previewInsert).toMatchObject({
      action_type: 'conversation.send',
      required_scope: 'customer:contact',
      idempotency_key: 'send-customer-1234',
      action_payload: {
        expected_updated_at: '2026-10-12T20:00:00Z',
      },
    })
  })

  it('refuses to prepare customer contact without the separate live grant', async () => {
    const { client, state } = fixture()

    await expect(
      previewConversationSend(
        {
          conversation_id: '10000000-0000-4000-8000-000000000001',
          body: 'This must not send.',
          media_ids: [],
          idempotency_key: 'send-customer-5678',
        },
        {
          subject: '40000000-0000-4000-8000-000000000001',
          label: 'Charles',
          scopes: ['business:read'],
        },
        client as never,
      ),
    ).rejects.toThrow('does not include customer:contact')
    expect(state.previewInsert).toBeNull()
  })

  it('previews an estimate decision without claiming customer contact or booking', async () => {
    const { client, state } = fixture()

    const result = await previewEstimateDecision(
      {
        estimate_id: '50000000-0000-4000-8000-000000000001',
        decision: 'accepted',
        reason: 'Charles confirmed by phone',
        idempotency_key: 'estimate-decision-1234',
      },
      {
        subject: '40000000-0000-4000-8000-000000000001',
        label: 'Charles',
        scopes: ['business:read', 'estimates:write'],
      },
      client as never,
    )

    expect(result.preview).toMatchObject({
      action: 'Mark estimate accepted',
      before: { estimate_status: 'sent' },
      after: { estimate_status: 'accepted' },
    })
    expect(JSON.stringify(result.preview)).toContain('Does not contact')
    expect(state.previewInsert).toMatchObject({
      action_type: 'estimate.decision',
      required_scope: 'estimates:write',
      action_payload: {
        expected_status: 'sent',
        expected_updated_at: '2026-10-12T21:00:00Z',
      },
    })
  })

  it('returns the recorded result when ChatGPT safely retries an executed confirmation', async () => {
    const query = {
      select() {
        return this
      },
      eq() {
        return this
      },
      maybeSingle: async () => ({
        data: {
          id: '30000000-0000-4000-8000-000000000001',
          actor_user_id: '40000000-0000-4000-8000-000000000001',
          action_type: 'conversation.send',
          required_scope: 'customer:contact',
          status: 'executed',
          result: {
            conversation_id: '10000000-0000-4000-8000-000000000001',
            twilio_sid: 'SM123',
          },
        },
        error: null,
      }),
    }
    const client = { from: () => query }

    const result = await executePreparedAction(
      {
        confirmation_id: '30000000-0000-4000-8000-000000000001',
        confirmed: true,
        expected_action_type: 'conversation.send',
      },
      {
        subject: '40000000-0000-4000-8000-000000000001',
        label: 'Charles',
        scopes: ['business:read', 'customer:contact'],
      },
      client as never,
    )

    expect(result).toEqual({
      conversation_id: '10000000-0000-4000-8000-000000000001',
      twilio_sid: 'SM123',
    })
  })

  it('expires a stale preview without executing its retained payload', async () => {
    let expiredUpdate: Record<string, unknown> | null = null
    const query = {
      select() {
        return this
      },
      eq() {
        return this
      },
      update(value: Record<string, unknown>) {
        expiredUpdate = value
        return this
      },
      maybeSingle: async () => ({
        data: {
          id: '30000000-0000-4000-8000-000000000001',
          actor_user_id: '40000000-0000-4000-8000-000000000001',
          action_type: 'conversation.send',
          required_scope: 'customer:contact',
          status: 'pending',
          expires_at: '2020-01-01T00:00:00.000Z',
          action_payload: { body: 'must never send' },
          payload_hash: 'unused-before-expiry',
        },
        error: null,
      }),
    }
    const client = { from: () => query }

    await expect(
      executePreparedAction(
        {
          confirmation_id: '30000000-0000-4000-8000-000000000001',
          confirmed: true,
          expected_action_type: 'conversation.send',
        },
        {
          subject: '40000000-0000-4000-8000-000000000001',
          label: 'Charles',
          scopes: ['business:read', 'customer:contact'],
        },
        client as never,
      ),
    ).rejects.toThrow('Confirmation expired')
    expect(expiredUpdate).toEqual({
      status: 'expired',
      action_payload: {},
      preview: {},
    })
  })
})
