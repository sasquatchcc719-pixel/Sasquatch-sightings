import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), db: {} }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/ops/payroll-gratuities', () => ({
  loadPayrollGratuities: mocks.load,
}))
import { GET } from './route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({})
  mocks.load.mockResolvedValue({
    rows: [],
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
