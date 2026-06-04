import { config as loadEnv } from 'dotenv'
import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/supabase/server'
import { opsPhoneLookupVariants } from '@/lib/ops/phone'

loadEnv({ path: '.env.local' })
import {
  looksLikeDeicticReference,
  extractGreetingName,
  recipientNameMatches,
} from './recipient-safety'

describe('looksLikeDeicticReference', () => {
  it('flags vague targets that must not be auto-resolved', () => {
    for (const t of [
      'this customer',
      'This Customer.',
      'them',
      'her',
      'the current conversation',
      'this thread',
    ]) {
      expect(looksLikeDeicticReference(t)).toBe(true)
    }
  })

  it('does not flag real names or phone numbers', () => {
    for (const t of [
      'Marianne',
      'Marianne Price',
      'Alex Yanak',
      '+14356719398',
      '435-671-9398',
    ]) {
      expect(looksLikeDeicticReference(t)).toBe(false)
    }
  })
})

describe('extractGreetingName', () => {
  it('pulls the greeted name', () => {
    expect(extractGreetingName('Hi Marianne, I’m sorry but…')).toBe('Marianne')
    expect(extractGreetingName('Hello Alex! Your info is…')).toBe('Alex')
    expect(extractGreetingName('Dear Randy,')).toBe('Randy')
  })

  it('ignores generic greetings and bodies with no greeting', () => {
    expect(extractGreetingName('Hi there, thanks!')).toBeNull()
    expect(extractGreetingName('Your appointment is confirmed.')).toBeNull()
  })
})

describe('recipientNameMatches', () => {
  const alex = {
    first_name: 'Alex',
    full_name: 'Alex Yanak',
    business_name: null,
  }
  const marianne = {
    first_name: 'Marianne',
    full_name: 'Marianne Price',
    business_name: null,
  }

  it('blocks a Marianne greeting resolved to Alex (the real incident)', () => {
    expect(recipientNameMatches(alex, 'Alex Yanak', 'Marianne')).toBe(false)
  })

  it('allows a matching greeting', () => {
    expect(recipientNameMatches(marianne, 'Marianne Price', 'Marianne')).toBe(
      true,
    )
    expect(recipientNameMatches(alex, 'Alex Yanak', 'Alex')).toBe(true)
  })
})

// Integration: confirm the real customer data drives the guards as intended.
describe('recipient resolution against the real DB', () => {
  const supabase = createAdminClient()

  async function findCustomerCandidates(target: string) {
    const customers = new Map<
      string,
      { id: string; full_name: string; phone: string | null }
    >()
    for (const column of ['business_name', 'full_name', 'email'] as const) {
      const { data } = await supabase
        .from('ops_customers')
        .select('id, full_name, phone')
        .ilike(column, `%${target}%`)
        .limit(5)
      for (const c of data || []) customers.set(c.id, c)
    }
    return Array.from(customers.values())
  }

  it('"Alex" is ambiguous → multiple candidates → send must stop and ask', async () => {
    const candidates = await findCustomerCandidates('Alex')
    expect(candidates.length).toBeGreaterThan(1)
  })

  it('"Marianne" resolves to a single customer with her correct number', async () => {
    const candidates = await findCustomerCandidates('Marianne')
    expect(candidates).toHaveLength(1)
    const variants = opsPhoneLookupVariants(candidates[0].phone || '')
    expect(variants).toContain('+14356719398')
  })
})
