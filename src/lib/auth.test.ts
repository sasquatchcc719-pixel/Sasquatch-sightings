// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), admin: vi.fn(), from: vi.fn() }))
vi.mock('@/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
  createAdminClient: mocks.admin,
}))
import { getUserWithRole, requireAuth } from './auth'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.admin.mockReturnValue({ from: mocks.from })
})

function membership(rows: Record<string, unknown>) {
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: rows[table] ?? null, error: null })),
    }
    return query
  })
}

describe('verified account membership', () => {
  it.each([null, { id: 'temporary', is_anonymous: true }])(
    'denies absent or anonymous identities before privileged lookup',
    async (user) => {
      mocks.getUser.mockResolvedValue({ data: { user } })
      expect(await getUserWithRole()).toEqual({
        user: null, role: null, partner: null, staff: null, client: null,
      })
      await expect(requireAuth()).rejects.toThrow('Not authenticated')
      expect(mocks.admin).not.toHaveBeenCalled()
    },
  )

  it('ignores self-editable role metadata', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: {
      id: 'unapproved', email: 'fixture@example.invalid',
      user_metadata: { role: 'admin' },
    } } })
    membership({})
    expect((await getUserWithRole()).role).toBeNull()
  })

  it('rejects unexpected partner roles rather than casting them to staff', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'partner-user' } } })
    membership({ partners: { id: 'partner', role: 'owner' } })
    expect((await getUserWithRole()).role).toBeNull()
  })

  it.each(['owner', 'dispatcher', 'tech', 'marketing'])(
    'preserves verified active %s membership', async (role) => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'staff-user' } } })
      membership({ staff_users: { id: 'staff', role, is_active: true } })
      expect((await getUserWithRole()).role).toBe(role)
    },
  )

  it('preserves a scoped commercial customer account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'client-user' } } })
    membership({ ops_client_users: { id: 'client', customer_id: 'customer', is_active: true } })
    const result = await getUserWithRole()
    expect(result.role).toBe('client_manager')
    expect(result.client?.customer_id).toBe('customer')
  })
})
