// @vitest-environment node
/**
 * Customer resolution against the real database. The property that matters is
 * that a repeat caller is matched on phone rather than being duplicated —
 * duplicate customer records are what wreck the history and the analytics.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'
import { resolveOrCreateCustomer } from '@/lib/ops/resolve-customer'

const supabase = createAdminClient()
// Twilio magic number — not routable, so nothing can be dialled or texted.
const TEST_PHONE = '+15005550063'
const created: string[] = []

afterAll(async () => {
  for (const id of created) {
    await supabase.from('ops_service_addresses').delete().eq('customer_id', id)
    await supabase.from('ops_customers').delete().eq('id', id)
  }
})

describe('resolveOrCreateCustomer', () => {
  it('creates a customer from a name and phone alone, with no email', async () => {
    const result = await resolveOrCreateCustomer(supabase, {
      customer: { full_name: 'Flood Test Caller', phone: TEST_PHONE },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toBe(true)
    created.push(result.customerId)

    const { data } = await supabase
      .from('ops_customers')
      .select('full_name, first_name, last_name, email')
      .eq('id', result.customerId)
      .single()
    // A Postgres trigger title-cases names, so compare case-insensitively.
    expect(data!.full_name.toLowerCase()).toBe('flood test caller')
    expect(data!.first_name.toLowerCase()).toBe('flood')
    expect(data!.email).toBeNull()
  })

  it('matches the same number again instead of duplicating', async () => {
    const again = await resolveOrCreateCustomer(supabase, {
      customer: { full_name: 'Flood Test Caller', phone: TEST_PHONE },
    })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.created).toBe(false)
    expect(again.customerId).toBe(created[0])

    const { data } = await supabase
      .from('ops_customers')
      .select('id')
      .eq('phone', TEST_PHONE)
    expect(data).toHaveLength(1)
  })

  it('refuses to open a job with no name or no phone', async () => {
    expect(await resolveOrCreateCustomer(supabase, { customer: { phone: TEST_PHONE } })).toEqual({
      ok: false,
      error: 'customer name is required',
    })
    expect(await resolveOrCreateCustomer(supabase, { customer: { full_name: 'No Phone' } })).toEqual(
      { ok: false, error: 'customer phone is required' },
    )
  })

  it('reports a bad customer id rather than silently creating one', async () => {
    const result = await resolveOrCreateCustomer(supabase, {
      customerId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result).toEqual({ ok: false, error: 'customer_not_found' })
  })
})
