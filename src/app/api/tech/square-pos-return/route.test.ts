// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  context: vi.fn(),
  payment: vi.fn(),
  invoice: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  current: vi.fn(),
  saved: vi.fn(),
  sync: vi.fn(),
  appointment: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.role }))
vi.mock('@/lib/tech/appointments', () => ({
  getChargeableInvoice: mocks.invoice,
}))
vi.mock('@/lib/payments/square-pos-verification', () => ({
  verifySquarePosContext: mocks.context,
  verifySquarePosPayment: mocks.payment,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureInvoiceQuickBooksSyncJob: mocks.sync,
}))
import { GET } from './route'
const context = {
  purpose: 'invoice',
  invoiceId: 'invoice-1',
  appointmentId: 'visit-1',
  actorId: 'actor-1',
  amountCents: 10000,
  returnTo: '/admin/operations/invoices/invoice-1',
  kind: 'payment',
}
function request(status = 'ok') {
  const url = new URL('https://example.test/api/tech/square-pos-return')
  url.searchParams.set(
    'data',
    JSON.stringify({
      status,
      transaction_id: 'order-1',
      state: 'signed-state',
      error_code: 'payment_canceled',
    }),
  )
  return new NextRequest(url)
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.role.mockResolvedValue({
    id: 'actor-1',
    role: 'tech',
    staff: { id: 'staff-1' },
  })
  mocks.context.mockReturnValue({ ...context })
  mocks.payment.mockResolvedValue({
    paymentId: 'payment-1',
    orderId: 'order-1',
    amountCents: 10000,
    paidAt: '2026-10-28T14:00:00Z',
  })
  mocks.invoice.mockResolvedValue({
    invoiceId: 'invoice-1',
    invoiceNumber: 12345,
    total: 100,
  })
  mocks.current.mockResolvedValue({ data: { square_payment_id: null } })
  mocks.saved.mockResolvedValue({ data: { id: 'invoice-1' } })
  const guard = { select: () => ({ maybeSingle: mocks.saved }) }
  const total = { eq: () => guard, is: () => guard }
  mocks.update.mockReturnValue({ eq: () => ({ eq: () => total }) })
  mocks.appointment.mockResolvedValue({ error: null })
  mocks.from.mockImplementation((table) =>
    table === 'ops_invoices'
      ? {
          select: () => ({ eq: () => ({ maybeSingle: mocks.current }) }),
          update: mocks.update,
        }
      : { update: () => ({ eq: mocks.appointment }) },
  )
})
describe('invoice POS return', () => {
  it.each([
    'anonymous',
    'unsigned',
    'wrong_actor',
    'restoration_context',
    'external_return',
  ])('rejects %s before invoice or provider access', async (failure) => {
    if (failure === 'anonymous')
      mocks.role.mockRejectedValue(new Error('Not authorized'))
    if (failure === 'unsigned')
      mocks.context.mockImplementation(() => {
        throw new Error('Invalid')
      })
    if (failure === 'wrong_actor')
      mocks.context.mockReturnValue({ ...context, actorId: 'other' })
    if (failure === 'restoration_context')
      mocks.context.mockReturnValue({ ...context, purpose: 'restoration' })
    if (failure === 'external_return')
      mocks.context.mockReturnValue({ ...context, returnTo: '//evil.test' })
    const response = await GET(request())
    expect(response.headers.get('location')).toBe(
      'https://example.test/tech?payment=verification_pending',
    )
    expect(mocks.invoice).not.toHaveBeenCalled()
    expect(mocks.payment).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('preserves signed cancellation without mutations', async () => {
    const response = await GET(request('error'))
    expect(response.headers.get('location')).toContain('payment=canceled')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(['not_accessible', 'invoice_changed', 'amount_changed'])(
    'rejects %s invoice before provider access',
    async (failure) => {
      mocks.invoice.mockResolvedValue(
        failure === 'not_accessible'
          ? null
          : {
              invoiceId: failure === 'invoice_changed' ? 'other' : 'invoice-1',
              total: failure === 'amount_changed' ? 101 : 100,
            },
      )
      await GET(request())
      expect(mocks.payment).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
    },
  )
  it('does not mark paid when provider proof fails', async () => {
    mocks.payment.mockRejectedValue(new Error('unverified'))
    const response = await GET(request())
    expect(response.headers.get('location')).toContain(
      'payment=verification_pending',
    )
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('checks current invoice ownership and persists verified payment facts before syncing', async () => {
    const response = await GET(request())
    expect(mocks.invoice).toHaveBeenCalledWith(expect.anything(), {
      role: 'tech',
      userId: 'staff-1',
      appointmentId: 'visit-1',
    })
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'paid',
        square_payment_id: 'payment-1',
        square_order_id: 'order-1',
        square_paid_cents: 10000,
      }),
    )
    expect(mocks.appointment).toHaveBeenCalledWith('id', 'visit-1')
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), 'invoice-1')
    expect(response.headers.get('location')).toContain('payment=success')
  })
  it('does not overwrite another payment or a concurrent invoice edit', async () => {
    mocks.current.mockResolvedValue({
      data: { square_payment_id: 'other-payment' },
    })
    await GET(request())
    expect(mocks.update).not.toHaveBeenCalled()
    mocks.current.mockResolvedValue({ data: { square_payment_id: null } })
    mocks.saved.mockResolvedValue({ data: null })
    const response = await GET(request())
    expect(response.headers.get('location')).toContain(
      'payment=verification_pending',
    )
    expect(mocks.appointment).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
