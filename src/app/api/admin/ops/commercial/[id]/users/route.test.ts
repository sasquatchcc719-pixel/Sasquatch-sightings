import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  requireAnyRole: vi.fn(),
  createAdminClient: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.requireAnyRole }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
import { POST } from './route'
const contact = {
  id: 'contact-a',
  display_name: 'Example Business',
  email: 'manager@example.com',
  is_active: true,
  can_sign_agreements: true,
}
function database(existing: typeof contact | null = null) {
  const clients = {
    select: vi.fn(() => clients),
    eq: vi.fn(() => clients),
    ilike: vi.fn(() => clients),
    maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
    insert: vi.fn(() => clients),
    single: vi.fn(async () => ({ data: contact, error: null })),
  }
  const customers = {
    select: vi.fn(() => customers),
    eq: vi.fn(() => customers),
    maybeSingle: vi.fn(async () => ({
      data: { id: 'customer-a' },
      error: null,
    })),
  }
  return {
    from: vi.fn((table: string) =>
      table === 'ops_customers' ? customers : clients,
    ),
    auth: {
      admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser },
    },
    clients,
  }
}
const context = { params: Promise.resolve({ id: 'customer-a' }) }
function request() {
  return new NextRequest('https://example.com/api/users', {
    method: 'POST',
    body: JSON.stringify({
      display_name: 'Example Business',
      email: 'Manager@Example.com',
      can_sign_agreements: true,
    }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.createUser.mockResolvedValue({
    data: { user: { id: 'new-auth-user' } },
    error: null,
  })
  mocks.createAdminClient.mockReturnValue(database())
})
describe('commercial portal contact provisioning', () => {
  it('returns the created contact, links only this customer, and never exposes the generated password', async () => {
    const db = database()
    mocks.createAdminClient.mockReturnValue(db)
    const result = await POST(request(), context)
    expect(result.status).toBe(201)
    expect(await result.json()).toEqual({ contact })
    expect(db.clients.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'customer-a',
        user_id: 'new-auth-user',
        email: 'manager@example.com',
        can_sign_agreements: true,
      }),
    )
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ app_metadata: { must_change_password: true } }),
    )
  })
  it('reuses the same account on retry without resetting its password', async () => {
    const db = database(contact)
    mocks.createAdminClient.mockReturnValue(db)
    const result = await POST(request(), context)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ contact })
    expect(db.clients.eq).toHaveBeenCalledWith('customer_id', 'customer-a')
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(db.clients.insert).not.toHaveBeenCalled()
  })
  it.each([
    { ...contact, is_active: false },
    { ...contact, can_sign_agreements: false },
  ])(
    'does not silently reactivate or elevate an existing contact',
    async (existing) => {
      mocks.createAdminClient.mockReturnValue(database(existing))
      expect((await POST(request(), context)).status).toBe(409)
      expect(mocks.createUser).not.toHaveBeenCalled()
    },
  )
  it('does not take over an unrelated existing auth account', async () => {
    const db = database()
    mocks.createAdminClient.mockReturnValue(db)
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email already exists' },
    })
    expect((await POST(request(), context)).status).toBe(409)
    expect(db.clients.insert).not.toHaveBeenCalled()
    expect(mocks.deleteUser).not.toHaveBeenCalled()
  })
})
