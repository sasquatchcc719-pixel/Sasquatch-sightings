import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  rows: [] as unknown[],
  blacklist: [] as unknown[],
  followUp: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET, PATCH } from './route'
import { NextRequest } from 'next/server'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({ id: 'owner-fixture' })
  mocks.followUp = {
    next_follow_up_date: '2099-11-01',
    reviewed_at: null,
    review_note: null,
    updated_at: '2026-10-26T18:00:00Z',
  }
  mocks.blacklist = []
  mocks.rows = [
    {
      id: 'parked',
      start_time: '10:00:00',
      end_time: '13:00:00',
      ops_customers: {
        full_name: 'Example',
        phone: '+15555550100',
        email: 'example@example.test',
        email_opt_out: true,
      },
    },
  ]
  mocks.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {}
    for (const name of [
      'select',
      'not',
      'order',
      'limit',
      'in',
      'update',
      'eq',
      'is',
    ])
      q[name] = vi.fn().mockReturnValue(q)
    q.maybeSingle = vi
      .fn()
      .mockImplementation(async () => ({ data: mocks.followUp, error: null }))
    q.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: table === 'blacklist' ? mocks.blacklist : mocks.rows,
        error: null,
      }).then(resolve)
    return q
  })
})
it('authenticates before exposing contact details', async () => {
  mocks.guard.mockRejectedValueOnce(new Error('Not authorized'))
  expect((await GET()).status).toBe(403)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('returns saved contact details, suppression and the original booked duration', async () => {
  const response = await GET()
  expect(response.status).toBe(200)
  expect((await response.json()).appointments[0]).toMatchObject({
    duration_minutes: 180,
    contact: {
      phone: '+15555550100',
      email: 'example@example.test',
      blocked: false,
      emailOptOut: true,
    },
  })
  expect(mocks.guard).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
})
it('matches blacklist entries across normalized phone formats', async () => {
  mocks.blacklist = [{ phone: '5555550100' }]
  expect((await (await GET()).json()).appointments[0].contact.blocked).toBe(
    true,
  )
})

function patchRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/admin/ops/schedule/parked', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appointment_id: '10000000-0000-4000-8000-000000000001',
      next_follow_up_date: '2099-11-01',
      expected_updated_at: '2026-10-26T18:00:00Z',
      ...overrides,
    }),
  })
}
it('rejects unauthorized follow-up edits before accessing the database', async () => {
  mocks.guard.mockRejectedValueOnce(new Error('Not authorized'))
  expect((await PATCH(patchRequest())).status).toBe(403)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('rejects an impossible date without writing', async () => {
  expect(
    (await PATCH(patchRequest({ next_follow_up_date: '2027-02-30' }))).status,
  ).toBe(400)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('saves only internal metadata and returns the saved date', async () => {
  const response = await PATCH(patchRequest())
  expect(response.status).toBe(200)
  expect((await response.json()).follow_up.next_follow_up_date).toBe(
    '2099-11-01',
  )
  expect(mocks.from).toHaveBeenCalledTimes(1)
  expect(mocks.from).toHaveBeenCalledWith('ops_unscheduled_follow_ups')
})
it('returns a conflict when another reviewer or a reschedule changed the row', async () => {
  mocks.followUp = null
  expect((await PATCH(patchRequest())).status).toBe(409)
})
