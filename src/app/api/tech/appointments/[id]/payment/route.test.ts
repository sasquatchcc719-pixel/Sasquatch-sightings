// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  getAppointment: vi.fn(),
  hidePricing: vi.fn(),
  db: vi.fn(),
  ensureInvoiceSync: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/lib/tech/appointments', () => ({
  getAssignedTechAppointment: mocks.getAppointment,
  shouldHideTechPricing: mocks.hidePricing,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureInvoiceQuickBooksSyncJob: mocks.ensureInvoiceSync,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({
    id: 'user-a',
    role: 'tech',
    staff: { id: 'staff-a' },
  })
  mocks.getAppointment.mockResolvedValue({
    id: 'appointment-a',
    hidePricing: false,
    invoice: { id: 'invoice-a' },
  })
  mocks.hidePricing.mockReturnValue(false)
  mocks.ensureInvoiceSync.mockResolvedValue({
    ok: true,
    queued: true,
    status: 'pending',
  })

  mocks.db.mockReturnValue({
    from: (table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({
          data:
            table === 'ops_appointments'
              ? {
                  id: 'appointment-a',
                  ops_customers: { full_name: 'Customer' },
                  ops_recurring_templates: null,
                }
              : null,
          error: null,
        })),
        then: (resolve: (value: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      }
      return builder
    },
  })
})

describe('recording a field payment', () => {
  it('queues the paid invoice for QuickBooks immediately', async () => {
    const response = await POST(
      new NextRequest(
        'https://example.com/api/tech/appointments/appointment-a/payment',
        {
          method: 'POST',
          body: JSON.stringify({ method: 'square' }),
        },
      ),
      { params: Promise.resolve({ id: 'appointment-a' }) },
    )

    expect(response.status).toBe(200)
    expect(mocks.ensureInvoiceSync).toHaveBeenCalledWith(
      expect.anything(),
      'invoice-a',
    )
  })
})
