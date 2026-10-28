// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  isEmailMarketingSuppressed,
  suppressedMarketingEmails,
  unsubscribeEmailMarketing,
} from './email-marketing-preferences'

describe('canonical marketing preferences', () => {
  it('normalizes, deduplicates and chunks lookups below the Data API row cap', async () => {
    const addresses = Array.from(
      { length: 401 },
      (_, i) => `person${i}@example.com`,
    )
    const filter = vi.fn(async (_column, values: string[]) => ({
      data: values.map((email) => ({ email })),
      error: null,
    }))
    const db = { from: vi.fn(() => ({ select: () => ({ in: filter }) })) }
    const result = await suppressedMarketingEmails(db as never, [
      ...addresses,
      ' PERSON0@EXAMPLE.COM ',
      null,
      '',
    ])
    expect(result.size).toBe(401)
    expect(filter.mock.calls.map((call) => call[1].length)).toEqual([
      200, 200, 1,
    ])
    expect(db.from).toHaveBeenCalledWith('email_marketing_suppressions')
  })

  it('recognizes a shared mailbox without requiring the same customer ID', async () => {
    const db = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{ email: 'person@example.com' }],
            error: null,
          }),
        }),
      }),
    }
    expect(
      await isEmailMarketingSuppressed(db as never, ' Person@Example.COM '),
    ).toBe(true)
  })

  it.each([
    { data: null, error: { code: '42501' } },
    { data: null, error: null },
  ])('fails closed for an unverified lookup: %s', async (result) => {
    const db = { from: () => ({ select: () => ({ in: async () => result }) }) }
    await expect(
      isEmailMarketingSuppressed(db as never, 'person@example.com'),
    ).rejects.toThrow('could not be verified')
  })

  it('saves the source message using the atomic service-only action', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: {
          success: true,
          already_unsubscribed: false,
          affected_customers: 2,
        },
        error: null,
      })
    const result = await unsubscribeEmailMarketing({ rpc } as never, {
      customerId: 'customer-a',
      source: 'owner_request',
      sourceMessageId: 'gmail-message-a',
    })
    expect(result.affected_customers).toBe(2)
    expect(rpc).toHaveBeenCalledWith('unsubscribe_email_marketing', {
      p_customer_id: 'customer-a',
      p_source: 'owner_request',
      p_source_message_id: 'gmail-message-a',
    })
  })
})
