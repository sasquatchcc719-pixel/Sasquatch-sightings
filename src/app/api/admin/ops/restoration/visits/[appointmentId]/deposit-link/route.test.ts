// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  lookup: vi.fn(),
  build: vi.fn(),
  sign: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.role }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }),
    }),
  }),
}))
vi.mock('@/lib/payments/square-pos', () => ({
  buildSquarePosUrl: mocks.build,
  detectMobilePlatform: () => 'ios',
}))
vi.mock('@/lib/payments/square-pos-verification', () => ({
  createSquarePosContext: mocks.sign,
}))
import { POST } from './route'
function request(body: Record<string, unknown> = { amount_cents: 10000 }) {
  return new NextRequest('https://example.test/api/charge', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ appointmentId: 'visit-1' }) }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SQUARE_APPLICATION_ID', 'application-1')
  vi.stubEnv('SQUARE_ACCESS_TOKEN', 'token-1')
  vi.stubEnv('SQUARE_LOCATION_ID', 'location-1')
  mocks.role.mockResolvedValue({ id: 'actor-1', role: 'owner' })
  mocks.lookup.mockResolvedValue({
    data: {
      id: 'visit-1',
      restoration_project_id: 'project-1',
      assigned_staff_user_id: 'staff-1',
    },
  })
  mocks.sign.mockReturnValue({
    state: 'signed-context',
    note: 'unique-provider-reference',
  })
  mocks.build.mockReturnValue('square-commerce-v1://payment')
})
afterEach(() => vi.unstubAllEnvs())
describe('restoration POS launch', () => {
  it('binds actor, visit, amount and kind and passes same provider location and note', async () => {
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(mocks.sign).toHaveBeenCalledWith({
      purpose: 'restoration',
      appointmentId: 'visit-1',
      amountCents: 10000,
      kind: 'deposit',
      actorId: 'actor-1',
      returnTo: '/admin/operations/restoration/project-1',
    })
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: 'location-1',
        note: 'unique-provider-reference',
        state: 'signed-context',
      }),
    )
  })
  it('requires provider verification configuration before handing off a charge', async () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', '')
    expect((await POST(request(), params)).status).toBe(503)
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('requires a restoration visit assigned to the technician', async () => {
    mocks.role.mockResolvedValue({
      id: 'actor-1',
      role: 'tech',
      staff: { id: 'other' },
    })
    expect((await POST(request(), params)).status).toBe(403)
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('allows the assigned technician', async () => {
    mocks.role.mockResolvedValue({
      id: 'actor-1',
      role: 'tech',
      staff: { id: 'staff-1' },
    })
    expect((await POST(request(), params)).status).toBe(200)
  })
  it('does not sign external or backslash return paths', async () => {
    await POST(
      request({ amount_cents: 10000, returnTo: '/\\evil.test' }),
      params,
    )
    expect(mocks.sign.mock.calls[0][0].returnTo).toBe(
      '/admin/operations/restoration/project-1',
    )
  })
  it('rejects unsafe numeric amounts', async () => {
    expect((await POST(request({ amount_cents: 1e30 }), params)).status).toBe(
      400,
    )
    expect(mocks.build).not.toHaveBeenCalled()
  })
})
