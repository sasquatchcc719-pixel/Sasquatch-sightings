// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({
  createClient: mocks.session,
  createAdminClient: mocks.admin,
}))
import { GET, PATCH } from './route'

const referralId = '10000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000002'
const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest('https://example.test/api/partners/outbound-referrals', {
    method: 'PATCH',
    body: JSON.stringify({
      referral_id: referralId,
      action: 'accept',
      ...extra,
    }),
  })
let auth: { data: { user: { id: string; is_anonymous?: boolean } | null }; error: Error | null }
const savedReceipt = {
  success: true,
  referral_id: referralId,
  status: 'accepted',
  replayed: false,
  client_name: 'Saved Client',
  client_phone: '7195550100',
  client_email: null,
  notes: null,
}
beforeEach(() => {
  vi.clearAllMocks()
  auth = { data: { user: { id: userId } }, error: null }
  // No table access is available: decisions must use one atomic server RPC.
  mocks.session.mockResolvedValue({
    auth: { getUser: vi.fn(async () => auth) },
  })
  mocks.admin.mockReturnValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: { ...savedReceipt }, error: null })
})

describe('verified partner outbound referral decisions', () => {
  it.each(['absent', 'invalid', 'anonymous'])(
    'requires a %s session to be rejected before server work',
    async (kind) => {
      if (kind === 'absent') auth.data.user = null
      else if (kind === 'anonymous') auth.data.user = { id: userId, is_anonymous: true }
      else auth.error = new Error('Invalid session')
      expect((await PATCH(request())).status).toBe(401)
      expect(mocks.admin).not.toHaveBeenCalled()
    },
  )
  it('denies anonymous referral reads before any table access', async () => {
    auth.data.user = { id: userId, is_anonymous: true }
    expect((await GET()).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it.each([
    { partner_id: 'forged-partner' },
    { p_user_id: 'forged-user' },
    { referral_fee: 0 },
    { referral_balance_owed: 0 },
    { status: 'completed' },
    { invoice_id: 'forged-invoice' },
    { action: 'complete' },
    { referral_id: 'invalid' },
  ])('rejects invalid or financial client fields: %j', async (extra) => {
    expect((await PATCH(request(extra))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('uses only the verified user, requested referral, and decision in one server transaction', async () => {
    const response = await PATCH(request())
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('review_partner_outbound_referral', {
      p_user_id: userId,
      p_referral_id: referralId,
      p_action: 'accept',
    })
    expect(await response.json()).toEqual(savedReceipt)
  })
  it('passes a matching replay receipt through so a retry does not create another charge', async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...savedReceipt, replayed: true },
      error: null,
    })
    expect(await (await PATCH(request())).json()).toMatchObject({
      success: true,
      replayed: true,
    })
  })
  it('declines using the same transaction without returning client contact details', async () => {
    const declined = {
      success: true,
      referral_id: referralId,
      status: 'declined',
      replayed: false,
    }
    mocks.rpc.mockResolvedValue({ data: declined, error: null })
    const response = await PATCH(request({ action: 'decline' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(declined)
    expect(mocks.rpc).toHaveBeenCalledWith(
      'review_partner_outbound_referral',
      expect.objectContaining({ p_action: 'decline' }),
    )
  })
  it.each([
    ['PARTNER_NOT_FOUND', 403],
    ['REFERRAL_NOT_FOUND', 404],
    ['DECISION_CONFLICT', 409],
  ] as const)('reports %s without claiming success', async (code, status) => {
    mocks.rpc.mockResolvedValue({ data: { success: false, code }, error: null })
    const response = await PATCH(request())
    expect(response.status).toBe(status)
    expect(await response.json()).not.toHaveProperty('success', true)
  })
  it.each([
    null,
    {
      success: true,
      referral_id: referralId,
      status: 'accepted',
      replayed: false,
    },
    { ...savedReceipt, referral_id: userId },
    { ...savedReceipt, status: 'declined' },
    { success: true },
  ])('refuses an incomplete or mismatched saved receipt: %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect((await PATCH(request())).status).toBe(500)
  })
  it('preserves retry guidance without exposing database error detail', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private database detail' },
    })
    const response = await PATCH(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Failed to process referral. Retry the same decision.',
    })
  })
})
