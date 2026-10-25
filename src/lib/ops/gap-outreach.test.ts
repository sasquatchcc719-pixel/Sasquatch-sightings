// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
vi.mock('@/lib/twilio', () => ({ sendCustomerSMSWithResult: vi.fn() }))
import {
  executeGapOutreach,
  requireGapScope,
  type GapSendDependencies,
} from './gap-outreach'
import { digest, type Gap } from './gap-planning'
const actor = {
  subject: 'owner',
  label: 'Owner',
  scopes: ['outreach:write', 'customer:contact'],
}
const gap: Gap = {
  date: '2099-10-27',
  staff_id: 'staff',
  staff_name: 'David',
  start_time: '10:00:00',
  end_time: '13:00:00',
  minutes: 180,
  internal: true,
  version: 'a'.repeat(64),
  before: null,
  after: null,
  slots: [],
}
function fixture() {
  const customers = [
    {
      customer_id: 'one',
      phone: '+17195550100',
      conversation_updated_at: 'before',
    },
    {
      customer_id: 'two',
      phone: '+17195550101',
      conversation_updated_at: 'before',
    },
  ]
  const recipients = customers.map((c) => ({
    id: c.customer_id,
    customer_id: c.customer_id,
    phone: c.phone,
    body: 'Exact approved body',
    eligibility_hash: digest(c),
    status: 'pending',
  }))
  const batch = {
    id: 'batch',
    actor_user_id: 'owner',
    status: 'pending',
    payload: { gap, recipients: recipients.map(({ status: _, ...r }) => r) },
    expires_at: '2099-10-27T00:00:00Z',
  }
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const r = recipients.find((r) => r.id === args.p_recipient)
    if (name === 'approve_gap_outreach') {
      if (batch.status !== 'pending') return { data: false, error: null }
      batch.status = 'approved'
      return { data: true, error: null }
    }
    if (name === 'claim_gap_outreach_recipient') {
      if (!r || r.status !== 'pending' || batch.status !== 'approved')
        return { data: false, error: null }
      r.status = 'sending'
      return { data: true, error: null }
    }
    if (name === 'check_gap_outreach_send')
      return { data: batch.status === 'approved', error: null }
    if (name === 'finish_gap_outreach_recipient') {
      if (r) r.status = 'accepted'
    }
    if (
      name === 'stop_gap_outreach' ||
      name === 'mark_gap_outreach_uncertain'
    ) {
      batch.status = 'stopped'
      for (const row of recipients) {
        if (row.status === 'pending') row.status = 'suppressed'
        if (row.status === 'sending' && name === 'mark_gap_outreach_uncertain')
          row.status = 'unknown'
      }
    }
    return { data: { ok: true }, error: null }
  })
  const db = {
    rpc: call,
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { ...batch }, error: null }),
        order: async () => ({
          data: table === 'gap_outreach_recipients' ? recipients : [],
          error: null,
        }),
      }
      return chain
    },
  } as unknown as SupabaseClient
  const send = vi.fn<NonNullable<GapSendDependencies['send']>>(async () => ({
    sid: 'SMfixture',
    to: '+17195550100',
    from: '+17195550199',
  }))
  const reload = vi.fn(async () => gap)
  const candidates = vi.fn(async () => ({ data: customers }))
  return {
    db,
    batch,
    recipients,
    customers,
    call,
    send,
    reload,
    candidates,
    deps: {
      enabled: () => true,
      send,
      reload,
      candidates: candidates as never,
      now: () => new Date('2099-10-25T12:00:00Z'),
    },
  }
}
describe('exact owner-approved gap batch execution', () => {
  it('is inactive by default and requires separate grants', async () => {
    const f = fixture()
    await expect(
      executeGapOutreach(f.db, 'batch', actor, { enabled: () => false }),
    ).rejects.toThrow('activation')
    expect(f.send).not.toHaveBeenCalled()
    expect(() =>
      requireGapScope({ ...actor, scopes: ['customer:contact'] }, true),
    ).toThrow()
  })
  it('sends only the exact named bodies and never substitutes', async () => {
    const f = fixture()
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.send.mock.calls[0][0]).toBe('+17195550100')
    expect(f.send.mock.calls[0][1]).toBe('Exact approved body')
  })
  it('concurrent execute requests cannot start two workers', async () => {
    const f = fixture()
    await Promise.all([
      executeGapOutreach(f.db, 'batch', actor, f.deps),
      executeGapOutreach(f.db, 'batch', actor, f.deps),
    ])
    expect(f.send).toHaveBeenCalledTimes(2)
  })
  it('rejects an expired approval before claiming or sending', async () => {
    const f = fixture()
    f.batch.expires_at = '2099-10-24T00:00:00Z'
    await expect(
      executeGapOutreach(f.db, 'batch', actor, f.deps),
    ).rejects.toThrow('expired')
    expect(f.send).not.toHaveBeenCalled()
  })
  it('stops after a booking changes live availability between customers', async () => {
    const f = fixture()
    f.send.mockImplementationOnce(async () => {
      f.reload.mockRejectedValue(new Error('filled'))
      return { sid: 'SMfirst', to: 'one', from: 'test' }
    })
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.recipients[1].status).toBe('suppressed')
  })
  it('stops pending work after an opt-out removes eligibility', async () => {
    const f = fixture()
    f.send.mockImplementationOnce(async () => {
      f.candidates.mockResolvedValue({ data: [] })
      return { sid: 'SMfirst', to: 'one', from: 'test' }
    })
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.recipients[1].status).toBe('suppressed')
  })
  it('stops when the owner takes over a conversation', async () => {
    const f = fixture()
    f.send.mockImplementationOnce(async () => {
      f.customers[1].conversation_updated_at = 'owner_reply_after_approval'
      return { sid: 'SMfirst', to: 'one', from: 'test' }
    })
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('records uncertainty and never retries after provider timeout', async () => {
    const f = fixture()
    f.send.mockRejectedValue(new Error('network result unknown'))
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.recipients[0].status).toBe('unknown')
    expect(f.recipients[1].status).toBe('suppressed')
  })
  it('does not send after a revoked claim preflight', async () => {
    const f = fixture()
    f.call
      .mockImplementationOnce(async () => ({ data: true, error: null }))
      .mockImplementationOnce(async () => ({ data: true, error: null }))
      .mockImplementationOnce(async () => ({ data: false, error: null }))
    await executeGapOutreach(f.db, 'batch', actor, f.deps)
    expect(f.send).not.toHaveBeenCalled()
  })
})
