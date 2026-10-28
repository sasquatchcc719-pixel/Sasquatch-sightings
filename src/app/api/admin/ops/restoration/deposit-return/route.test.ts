// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  verifyContext: vi.fn(),
  verifyPayment: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  lookup: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.role }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
vi.mock('@/lib/payments/square-pos-verification', () => ({
  verifySquarePosContext: mocks.verifyContext,
  verifySquarePosPayment: mocks.verifyPayment,
}))
import { GET } from './route'
const context = {
  purpose: 'restoration',
  appointmentId: 'visit-1',
  amountCents: 10000,
  kind: 'deposit',
  returnTo: '/admin/operations/restoration/project-1',
  actorId: 'owner-1',
}
const verified = {
  paymentId: 'payment-1',
  orderId: 'order-1',
  amountCents: 10000,
  paidAt: '2026-10-28T14:00:00Z',
}
function request(
  data = { status: 'ok', transaction_id: 'order-1', state: 'signed-state' },
) {
  const url = new URL(
    'https://example.test/api/admin/ops/restoration/deposit-return',
  )
  url.searchParams.set('data', JSON.stringify(data))
  return new NextRequest(url)
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.role.mockResolvedValue({
    id: 'owner-1',
    role: 'owner',
    staff: { id: 'staff-1' },
  })
  mocks.verifyContext.mockReturnValue({ ...context })
  mocks.verifyPayment.mockResolvedValue({ ...verified })
  mocks.insert.mockResolvedValue({ error: null })
  mocks.lookup.mockResolvedValue({
    data: {
      id: 'visit-1',
      restoration_project_id: 'project-1',
      assigned_staff_user_id: 'staff-1',
    },
    error: null,
  })
  mocks.from.mockImplementation((table) =>
    table === 'ops_payments'
      ? {
          insert: mocks.insert,
          select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }),
        }
      : { select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) },
  )
})
describe('restoration POS redirect', () => {
  it('rejects an unauthenticated forged success before database/provider access', async () => {
    mocks.role.mockRejectedValue(new Error('Not authorized'))
    const response = await GET(request())
    expect(response.headers.get('location')).toBe(
      'https://example.test/admin/operations?deposit=error',
    )
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.verifyPayment).not.toHaveBeenCalled()
  })
  it.each([
    'unsigned',
    'different_actor',
    'external_return',
    'backslash_return',
  ])('rejects %s state without database access', async (kind) => {
    if (kind === 'unsigned')
      mocks.verifyContext.mockImplementation(() => {
        throw new Error('Invalid')
      })
    else
      mocks.verifyContext.mockReturnValue({
        ...context,
        ...(kind === 'different_actor'
          ? { actorId: 'other' }
          : {
              returnTo:
                kind === 'external_return' ? '//evil.test' : '/\\evil.test',
            }),
      })
    const response = await GET(request())
    expect(response.headers.get('location')).toContain('deposit=error')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('keeps signed cancellation redirect without payment write', async () => {
    const response = await GET(
      request({
        status: 'error',
        transaction_id: '',
        state: 'signed-state',
        error_code: 'payment_canceled',
      } as never),
    )
    expect(response.headers.get('location')).toBe(
      'https://example.test/admin/operations/restoration/project-1?deposit=canceled',
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('refuses offline success with no server transaction ID', async () => {
    const response = await GET(
      request({ status: 'ok', transaction_id: '', state: 'signed-state' }),
    )
    expect(response.headers.get('location')).toContain('deposit=error')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects a technician not assigned to the restoration visit', async () => {
    mocks.role.mockResolvedValue({
      id: 'owner-1',
      role: 'tech',
      staff: { id: 'other-staff' },
    })
    await GET(request())
    expect(mocks.verifyPayment).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('records only provider-confirmed fields and real payment ID', async () => {
    const response = await GET(request())
    expect(mocks.verifyPayment).toHaveBeenCalledWith('order-1', context)
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        appointment_id: 'visit-1',
        square_payment_id: 'payment-1',
        square_order_id: 'order-1',
        amount_cents: 10000,
        paid_at: verified.paidAt,
        recorded_by_user_id: 'owner-1',
      }),
    )
    expect(response.headers.get('location')).toContain('deposit=paid')
  })
  it('never writes when provider verification fails', async () => {
    mocks.verifyPayment.mockRejectedValue(new Error('unmatched order'))
    const response = await GET(request())
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toContain('deposit=error')
  })
  it.each([true, false])(
    'accepts duplicate only if already bound to the same visit and amount: %s',
    async (same) => {
      mocks.insert.mockResolvedValue({ error: { code: '23505' } })
      mocks.lookup
        .mockResolvedValueOnce({
          data: { restoration_project_id: 'project-1' },
        })
        .mockResolvedValueOnce({
          data: {
            appointment_id: same ? 'visit-1' : 'different-visit',
            amount_cents: 10000,
            kind: 'deposit',
          },
        })
      const response = await GET(request())
      expect(response.headers.get('location')).toContain(
        same ? 'deposit=paid' : 'deposit=error',
      )
    },
  )
})
