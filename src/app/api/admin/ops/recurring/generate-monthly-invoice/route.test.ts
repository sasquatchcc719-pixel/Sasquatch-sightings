// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  sync: vi.fn(),
  ensureJob: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/quickbooks-api', () => ({
  syncBatchInvoiceToQuickBooks: mocks.sync,
}))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureBatchInvoiceQuickBooksSyncJob: mocks.ensureJob,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ role: 'owner' })
  mocks.admin.mockReturnValue({
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          table === 'ops_customers'
            ? {
                data: {
                  id: 'customer-1',
                  billing_mode: 'monthly_consolidated',
                },
              }
            : {
                data: {
                  id: 'batch-1',
                  status: 'sent',
                  sync_status: 'synced',
                  quickbooks_invoice_id: '6902',
                },
              },
        ),
      }
      return query
    }),
  })
})

describe('monthly invoice repeat confirmation', () => {
  it('returns the existing QuickBooks ID instead of reporting a false failure', async () => {
    const response = await POST(
      new NextRequest(
        'https://example.com/api/admin/ops/recurring/generate-monthly-invoice',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId: 'customer-1',
            month: '2026-09-01',
            appointmentIds: ['appointment-1'],
          }),
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      batchInvoiceId: 'batch-1',
      quickbooksInvoiceId: '6902',
      alreadySent: true,
    })
    expect(mocks.sync).not.toHaveBeenCalled()
  })
})
