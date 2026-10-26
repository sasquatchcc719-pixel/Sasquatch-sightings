import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  rows: [] as unknown[],
  blacklist: [] as unknown[],
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({})
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
    for (const name of ['select', 'not', 'order', 'limit', 'in'])
      q[name] = vi.fn().mockReturnValue(q)
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
