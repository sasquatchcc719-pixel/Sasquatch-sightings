// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deliverPreparedEstimateQuote,
  prepareEstimateQuote,
} from './estimate-email-delivery'

const estimate = {
  id: '10000000-0000-4000-8000-000000000001',
  quoted_total: 425,
  estimate_status: 'draft',
  converted_appointment_id: null,
  updated_at: '2026-10-12T20:00:00Z',
  ops_customers: {
    id: '20000000-0000-4000-8000-000000000001',
    full_name: 'Test Customer',
    first_name: 'Test',
    email: 'test@example.com',
    phone: '+17195550123',
    email_opt_out: false,
  },
  ops_service_addresses: {
    street_1: '123 Main St',
    city: 'Colorado Springs',
    state: 'CO',
    zip_code: '80903',
  },
  ops_appointment_line_items: [
    {
      name_snapshot: 'Carpet cleaning',
      quantity: 1,
      unit_price: 425,
      line_total: 425,
      notes: null,
      pricing_unit_snapshot: 'fixed',
    },
  ],
}

class Query {
  private mode: 'read' | 'update' | 'insert' = 'read'

  constructor(
    private readonly table: string,
    private readonly state: { inserts: Array<Record<string, unknown>> },
  ) {}
  select() {
    return this
  }
  eq() {
    return this
  }
  is() {
    return this
  }
  update() {
    this.mode = 'update'
    return this
  }
  insert(value: Record<string, unknown>) {
    this.mode = 'insert'
    this.state.inserts.push({ table: this.table, ...value })
    return Promise.resolve({ error: null })
  }
  maybeSingle() {
    if (this.table === 'ops_appointments' && this.mode === 'read') {
      return Promise.resolve({ data: estimate, error: null })
    }
    if (this.table === 'ops_appointments' && this.mode === 'update') {
      return Promise.resolve({ data: { id: estimate.id }, error: null })
    }
    throw new Error(`Unexpected maybeSingle ${this.table}/${this.mode}`)
  }
}

function fixture() {
  const state = { inserts: [] as Array<Record<string, unknown>> }
  return {
    state,
    client: {
      from(table: string) {
        return new Query(table, state)
      },
    },
  }
}

describe('shared estimate quote delivery', () => {
  beforeEach(() => {
    process.env.PAYMENT_LINK_SIGNING_SECRET = 'synthetic-test-secret'
  })

  it('prepares and sends the reviewed body with provider idempotency', async () => {
    const { client, state } = fixture()
    const prepared = await prepareEstimateQuote({
      supabase: client as never,
      estimateId: estimate.id,
      publicOrigin: 'https://sightings.sasquatchcarpet.com',
      decisionExpiresAt: '2026-11-12T20:00:00.000Z',
      isPhoneBlacklisted: async () => false,
    })
    expect(prepared).toMatchObject({
      recipient: 'test@example.com',
      total: 425,
      previous_status: 'draft',
    })
    expect(prepared.body_text).toContain('Estimated Total: $425.00')
    expect(prepared.html).toContain('Accept this estimate')

    const sendEmail = vi.fn().mockResolvedValue({ id: 'email-provider-123' })
    const result = await deliverPreparedEstimateQuote({
      supabase: client as never,
      prepared,
      actorId: '30000000-0000-4000-8000-000000000001',
      reopen: false,
      providerIdempotencyKey: 'mcp-estimate-quote/stable-key',
      sendEmail,
    })

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        idempotencyKey: 'mcp-estimate-quote/stable-key',
      }),
    )
    expect(result).toMatchObject({
      success: true,
      provider_message_id: 'email-provider-123',
      warning: null,
    })
    expect(state.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'ops_email_log',
          resend_id: 'email-provider-123',
        }),
        expect.objectContaining({
          table: 'ops_appointment_status_events',
          to_status: 'sent',
        }),
      ]),
    )
  })

  it('fails closed before preparing email for a suppressed customer', async () => {
    const { client } = fixture()
    await expect(
      prepareEstimateQuote({
        supabase: client as never,
        estimateId: estimate.id,
        publicOrigin: 'https://sightings.sasquatchcarpet.com',
        decisionExpiresAt: '2026-11-12T20:00:00.000Z',
        isPhoneBlacklisted: async () => true,
      }),
    ).rejects.toThrow('suppressed')
  })
})
