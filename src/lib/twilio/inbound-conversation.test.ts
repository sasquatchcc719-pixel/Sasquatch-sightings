// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { adoptAdminOutboundConversation } from './inbound-conversation'

function fixture(
  candidate: Record<string, unknown> | null,
  updateError: unknown = null,
) {
  const update = vi.fn()
  const db = {
    from() {
      const q = {
        select() {
          return q
        },
        eq() {
          return q
        },
        order() {
          return q
        },
        limit() {
          return q
        },
        maybeSingle: async () => ({ data: candidate, error: null }),
        update(values: Record<string, unknown>) {
          update(values)
          return {
            eq: async () => ({ error: updateError }),
          }
        },
      }
      return q
    },
  }
  return { db, update }
}

describe('first-outbound inbound reply reconciliation', () => {
  it('adopts the exact-phone outbound thread and preserves its lead/history', async () => {
    const f = fixture({
      id: 'conversation',
      phone_number: '+17195550100',
      source: 'admin_outbound',
      status: 'active',
      lead_id: 'lead',
      ops_customer_id: null,
      messages: [
        {
          role: 'assistant',
          content: 'Exact approved question',
          twilio_sid: 'SMaccepted',
        },
      ],
    })

    const result = await adoptAdminOutboundConversation(f.db as never, {
      phone: '+17195550100',
      inboundSource: 'inbound',
      opsCustomerId: null,
    })

    expect(result).toMatchObject({
      id: 'conversation',
      source: 'inbound',
      lead_id: 'lead',
      messages: [{ twilio_sid: 'SMaccepted' }],
    })
    expect(f.update).toHaveBeenCalledWith({
      source: 'inbound',
      status: 'active',
    })
  })

  it('does not overwrite a different household contact on a shared phone', async () => {
    const f = fixture({
      id: 'conversation',
      phone_number: '+17195550100',
      source: 'admin_outbound',
      status: 'active',
      ops_customer_id: 'customer-a',
    })

    const result = await adoptAdminOutboundConversation(f.db as never, {
      phone: '+17195550100',
      inboundSource: 'inbound',
      opsCustomerId: 'customer-b',
    })

    expect(result).toBeNull()
    expect(f.update).not.toHaveBeenCalled()
  })

  it('returns no thread when provider finalization has not created one yet', async () => {
    const f = fixture(null)
    await expect(
      adoptAdminOutboundConversation(f.db as never, {
        phone: '+17195550100',
        inboundSource: 'inbound',
        opsCustomerId: null,
      }),
    ).resolves.toBeNull()
    expect(f.update).not.toHaveBeenCalled()
  })
})
