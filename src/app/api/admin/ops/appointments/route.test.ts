// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  blocked: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blocked }))
vi.mock('@/lib/ops/communications', () => ({
  sendOpsLifecycleCommunications: vi.fn(),
}))
vi.mock('@/lib/ops/drip-campaign', () => ({ enrollCustomerInDrip: vi.fn() }))
vi.mock('@/lib/ops/reactivation-campaign', () => ({
  cancelReactivationForCustomer: vi.fn(),
}))
vi.mock('@/lib/ops/review-requests', () => ({
  suppressPostJobReviewRequest: vi.fn(),
}))
vi.mock('@/lib/quickbooks-api', () => ({
  syncAppointmentToQuickBooks: vi.fn(),
}))

import { POST } from './route'

describe('manual appointment blacklist enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ id: 'admin', role: 'admin' })
  })

  it('rejects a blacklisted phone before creating or updating any records', async () => {
    const from = vi.fn()
    mocks.admin.mockReturnValue({ from })
    mocks.blocked.mockResolvedValue(true)

    const response = await POST(
      new NextRequest('https://example.com/api/admin/ops/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            first_name: 'Marianne',
            last_name: 'Price',
            phone: '+14356719398',
            email: 'noemail@noemail.com',
          },
        }),
      }),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'This customer is blacklisted and cannot book appointments.',
    })
    expect(mocks.blocked).toHaveBeenCalledWith('+14356719398')
    expect(from).not.toHaveBeenCalled()
  })

  it('checks the saved customer before replacing their phone', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { phone: '+14356719398' },
        error: null,
      }),
    }
    mocks.admin.mockReturnValue({ from: vi.fn(() => query) })
    mocks.blocked.mockImplementation(async (phone) => phone === '+14356719398')
    const response = await POST(
      new NextRequest('https://example.com/api/admin/ops/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: 'blocked-customer',
          customer: {
            first_name: 'Marianne',
            last_name: 'Price',
            phone: '+17195550100',
            email: 'noemail@noemail.com',
          },
        }),
      }),
    )
    expect(response.status).toBe(403)
    expect(query.eq).toHaveBeenCalledWith('id', 'blocked-customer')
    expect(mocks.blocked).toHaveBeenCalledWith('+14356719398')
  })

  it('lets an unblocked phone continue through normal form validation', async () => {
    mocks.admin.mockReturnValue({ from: vi.fn() })
    mocks.blocked.mockResolvedValue(false)
    const response = await POST(
      new NextRequest('https://example.com/api/admin/ops/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customer: {
            first_name: 'Allowed',
            last_name: 'Customer',
            phone: '+17195550100',
            email: 'customer@example.com',
          },
        }),
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe(
      'Service address must include street, city, and zip code',
    )
  })
})
