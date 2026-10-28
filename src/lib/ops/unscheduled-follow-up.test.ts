// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  projectUnscheduledFollowUp,
  saveUnscheduledFollowUp,
  saveUnscheduledFollowUpInput,
} from './unscheduled-follow-up'
import { setUnscheduledFollowUp } from '@/lib/mcp/business-operations'
const row = {
  next_follow_up_date: '2026-11-01',
  reviewed_at: null,
  review_note: null,
  updated_at: '2026-10-26T18:00:00Z',
}
const input = {
  appointment_id: '10000000-0000-4000-8000-000000000001',
  next_follow_up_date: '2099-11-01',
  expected_updated_at: row.updated_at,
  review_note: 'Checked conversation; waiting for customer preferred dates.',
}
function fixture(data: unknown = row) {
  const q = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  }
  for (const method of ['update', 'eq', 'is', 'select'] as const)
    q[method].mockReturnValue(q)
  const from = vi.fn().mockReturnValue(q)
  return { db: { from } as never, from, q }
}
it('uses the Denver date rather than UTC at the due boundary', () => {
  expect(
    projectUnscheduledFollowUp(row, new Date('2026-11-01T05:59:59Z'))?.due,
  ).toBe(false)
  expect(
    projectUnscheduledFollowUp(row, new Date('2026-11-01T06:00:00Z'))?.due,
  ).toBe(true)
  expect(
    projectUnscheduledFollowUp({ ...row, resolved_at: '2026-10-31T17:00:00Z' }),
  ).toBeNull()
})
it('rejects invalid dates and missing optimistic-lock versions', () => {
  expect(
    saveUnscheduledFollowUpInput.safeParse({
      ...input,
      next_follow_up_date: '2027-02-30',
    }).success,
  ).toBe(false)
  expect(
    saveUnscheduledFollowUpInput.safeParse({
      ...input,
      expected_updated_at: undefined,
    }).success,
  ).toBe(false)
})
it('records a review through only the internal task table with stale and resolved checks', async () => {
  const f = fixture()
  await saveUnscheduledFollowUp(f.db, input, 'owner')
  expect(f.from).toHaveBeenCalledTimes(1)
  expect(f.from).toHaveBeenCalledWith('ops_unscheduled_follow_ups')
  expect(f.q.eq).toHaveBeenCalledWith('updated_at', row.updated_at)
  expect(f.q.is).toHaveBeenCalledWith('resolved_at', null)
  expect(f.q.update).toHaveBeenCalledWith(
    expect.objectContaining({
      reviewed_by: 'owner',
      review_note: input.review_note,
      next_follow_up_date: input.next_follow_up_date,
    }),
  )
})
it('does not silently overwrite a newer review or reopen a rescheduled job', async () => {
  const f = fixture(null)
  await expect(saveUnscheduledFollowUp(f.db, input, 'owner')).rejects.toThrow(
    'Refresh',
  )
})
it('requires a write scope and review note before Harry changes the date', async () => {
  const f = fixture()
  await expect(
    setUnscheduledFollowUp(
      input,
      { subject: 'owner', label: 'Harry', scopes: ['business:read'] },
      f.db,
    ),
  ).rejects.toThrow('business:write')
  await expect(
    setUnscheduledFollowUp(
      { ...input, review_note: undefined },
      { subject: 'owner', label: 'Harry', scopes: ['business:write'] },
      f.db,
    ),
  ).rejects.toThrow('review note')
  expect(f.from).not.toHaveBeenCalled()
})

it('uses saved Mountain wall time on the due day, including after DST ends', () => {
  const timed = { ...row, next_follow_up_time: '09:30:00' }
  expect(
    projectUnscheduledFollowUp(timed, new Date('2026-11-01T16:29:00Z'))?.due,
  ).toBe(false)
  expect(
    projectUnscheduledFollowUp(timed, new Date('2026-11-01T16:30:00Z'))?.due,
  ).toBe(true)
})
it('validates a planned time and records the editor identity atomically with the plan', async () => {
  expect(
    saveUnscheduledFollowUpInput.safeParse({
      ...input,
      next_follow_up_time: '25:30',
    }).success,
  ).toBe(false)
  const f = fixture()
  await saveUnscheduledFollowUp(
    f.db,
    { ...input, next_follow_up_time: '14:30' },
    'owner',
    'Connected assistant · Harry',
  )
  expect(f.q.update).toHaveBeenCalledWith(
    expect.objectContaining({
      next_follow_up_time: '14:30',
      updated_by_label: 'Connected assistant · Harry',
    }),
  )
})
