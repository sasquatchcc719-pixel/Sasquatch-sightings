// @vitest-environment node
/**
 * Integration test for the Conversations customer-context enrichment against
 * the real DB. Verifies the batched lookups resolve name/email/address/invoice
 * and map back to the right customer ids.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { getCustomerContextForConversations } from './conversation-customer-context'

describe('getCustomerContextForConversations against the real DB', () => {
  const supabase = createAdminClient()

  it('returns an empty map for no ids', async () => {
    const result = await getCustomerContextForConversations(supabase, [
      null,
      undefined,
    ])
    expect(result.size).toBe(0)
  })

  it('resolves context for real scheduled-customer conversations', async () => {
    const { data: convos } = await supabase
      .from('conversations')
      .select('ops_customer_id')
      .not('ops_customer_id', 'is', null)
      .limit(25)

    const ids = (convos || []).map((c) => c.ops_customer_id as string)
    if (ids.length === 0) return // no linked customers right now

    const result = await getCustomerContextForConversations(supabase, ids)

    // Every returned id must be one we asked for, and shape must be correct.
    for (const [id, ctx] of result.entries()) {
      expect(ids).toContain(id)
      expect(ctx).toHaveProperty('name')
      expect(ctx).toHaveProperty('email')
      expect(ctx).toHaveProperty('address')
      expect(ctx).toHaveProperty('invoice')
      if (ctx.address) {
        expect(ctx.mapsUrl).toContain(
          'https://www.google.com/maps/search/?api=1&query=',
        )
      }
      if (ctx.invoice) {
        expect(typeof ctx.invoice.id).toBe('string')
      }
    }

    // At least one customer should resolve to a real record with a name.
    const named = Array.from(result.values()).filter((c) => c.name)
    expect(named.length).toBeGreaterThan(0)
  })
})
