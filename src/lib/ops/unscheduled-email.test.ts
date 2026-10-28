// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  recordUnscheduledEmail,
  recordUnscheduledEmailInput,
} from './unscheduled-email'
import { recordUnscheduledEmailEvidence } from '@/lib/mcp/business-operations'
const actor = '10000000-0000-4000-8000-000000000001'
const input = {
  appointment_id: '20000000-0000-4000-8000-000000000001',
  message_id: '1a1798436c57eef1',
  thread_id: '1a1795a4342d158c',
  occurred_at: '2026-10-26T18:33:28Z',
  from_email: 'customer@example.com',
  to_email: 'sasquatchcc719@gmail.com',
  subject: 'Re: Cleaning',
  body_text: 'After November 1 please',
}
function fixture(
  options: { missing?: boolean; conflict?: boolean; failure?: boolean } = {},
) {
  let saved: Record<string, unknown> | null = null
  const insert = vi.fn((row) => {
    if (!saved) saved = { ...row, id: actor }
    if (options.conflict) saved = { ...saved, body_text: 'Other content' }
    return Promise.resolve({
      error: options.failure ? new Error('Write failed') : null,
    })
  })
  const from = vi.fn((table) => {
    const q: Record<string, ReturnType<typeof vi.fn>> = {}
    for (const method of ['select', 'eq', 'not'])
      q[method] = vi.fn().mockReturnValue(q)
    q.maybeSingle = vi
      .fn()
      .mockResolvedValue({
        data: options.missing
          ? null
          : {
              customer_id: 'customer',
              customer: { email: 'customer@example.com' },
            },
        error: null,
      })
    q.upsert = insert
    q.single = vi.fn(async () => ({ data: saved, error: null }))
    if (table !== 'ops_appointments' && table !== 'ops_customer_email_history')
      throw new Error('Unexpected write or communication')
    return q
  })
  return { db: { from } as never, insert, from }
}
it('imports incoming and outgoing evidence with original times and idempotent retries', async () => {
  const f = fixture()
  expect(
    await recordUnscheduledEmail(f.db, input, actor, 'Harry'),
  ).toMatchObject({ direction: 'inbound', id: actor })
  expect(
    await recordUnscheduledEmail(f.db, input, actor, 'Harry'),
  ).toMatchObject({ id: actor })
  expect(f.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      occurred_at: input.occurred_at,
      recorded_by: actor,
      direction: 'inbound',
    }),
    { onConflict: 'mailbox,message_id', ignoreDuplicates: true },
  )
  const outgoing = {
    ...input,
    from_email: input.to_email,
    to_email: input.from_email,
  }
  expect(
    await recordUnscheduledEmail(fixture().db, outgoing, actor, 'Harry'),
  ).toMatchObject({ direction: 'outbound' })
})
it('rejects wrong customers, future dates, missing parked jobs, changed evidence and write failures', async () => {
  for (const invalid of [
    { ...input, from_email: 'other@example.com' },
    { ...input, occurred_at: '2099-01-01T00:00:00Z' },
  ]) {
    const f = fixture()
    await expect(
      recordUnscheduledEmail(f.db, invalid, actor, 'Harry'),
    ).rejects.toThrow()
    expect(f.insert).not.toHaveBeenCalled()
  }
  await expect(
    recordUnscheduledEmail(
      fixture({ missing: true }).db,
      input,
      actor,
      'Harry',
    ),
  ).rejects.toThrow('not found')
  await expect(
    recordUnscheduledEmail(
      fixture({ conflict: true }).db,
      input,
      actor,
      'Harry',
    ),
  ).rejects.toThrow('different evidence')
  await expect(
    recordUnscheduledEmail(
      fixture({ failure: true }).db,
      input,
      actor,
      'Harry',
    ),
  ).rejects.toThrow('Write failed')
  expect(
    recordUnscheduledEmailInput.safeParse({ ...input, message_id: 'invented' })
      .success,
  ).toBe(false)
})
it('requires business write permission before any database access', async () => {
  const f = fixture()
  await expect(
    recordUnscheduledEmailEvidence(
      input,
      { subject: actor, label: 'Harry', scopes: ['business:read'] },
      f.db,
    ),
  ).rejects.toThrow('business:write')
  expect(f.from).not.toHaveBeenCalled()
})
