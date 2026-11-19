import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  loadOverrides: vi.fn(),
  db: {},
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/ops/payroll-gratuities', () => ({
  loadPayrollGratuities: mocks.load,
}))
vi.mock('@/lib/ops/payroll-component-overrides', () => ({
  loadPayrollComponentOverrides: mocks.loadOverrides,
}))
import { GET } from './route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({})
  mocks.loadOverrides.mockResolvedValue(new Map())
  mocks.load.mockResolvedValue({
    rows: [
      {
        invoiceId: 'invoice',
        amount: 50,
        status: 'payable',
      },
    ],
    payableGratuity: 50,
    pendingGratuity: 0,
  })
})
describe('payroll gratuities API', () => {
  it('requires owner/admin access before reading payroll', async () => {
    mocks.auth.mockRejectedValue(new Error('Not authorized'))
    expect(
      (
        await GET(
          new NextRequest(
            'https://example.com/api?startDate=2026-10-11&endDate=2026-10-24',
          ),
        )
      ).status,
    ).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
  })
  it('validates date ranges and forwards the staff filter', async () => {
    expect(
      (
        await GET(
          new NextRequest(
            'https://example.com/api?startDate=2026-02-30&endDate=2026-10-24',
          ),
        )
      ).status,
    ).toBe(400)
    const res = await GET(
      new NextRequest(
        'https://example.com/api?startDate=2026-10-11&endDate=2026-10-24&staffUserId=david',
      ),
    )
    expect(res.status).toBe(200)
    expect(mocks.load).toHaveBeenCalledWith(mocks.db, {
      startDate: '2026-10-11',
      endDate: '2026-10-24',
      staffUserId: 'david',
    })
    expect((await res.json()).payableGratuity).toBe(50)
  })
  it('uses a saved override while preserving the calculated source amount', async () => {
    mocks.loadOverrides.mockResolvedValue(new Map([['invoice', 65.25]]))
    const res = await GET(
      new NextRequest(
        'https://example.com/api?startDate=2026-10-11&endDate=2026-10-24',
      ),
    )
    const data = await res.json()
    expect(data.payableGratuity).toBe(65.25)
    expect(data.rows[0]).toMatchObject({
      amount: 65.25,
      calculatedAmount: 50,
      overrideAmount: 65.25,
    })
  })
  it('returns a failure instead of a misleading empty gratuity total', async () => {
    mocks.load.mockRejectedValue(new Error('database unavailable'))
    expect(
      (
        await GET(
          new NextRequest(
            'https://example.com/api?startDate=2026-10-11&endDate=2026-10-24',
          ),
        )
      ).status,
    ).toBe(500)
  })
})
