import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/quickbooks-auth', () => ({
  getQBConnectionStatus: vi.fn(async () => ({
    connected: true,
    sync_enabled: true,
  })),
  getValidQBAccessToken: vi.fn(async () => {
    throw new Error('network timeout')
  }),
}))
const mocks = vi.hoisted(() => ({ db: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'

describe('immediate invoice sync retry policy', () => {
  it('keeps customer and invoice jobs pending after a temporary auth-service outage', async () => {
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
    mocks.db.mockReturnValue({
      from: (table: string) => {
        const result = () => ({
          data:
            table === 'ops_appointments'
              ? {
                  id: 'appointment',
                  kind: 'service',
                  appointment_date: '2026-10-20',
                  ops_customers: {
                    id: 'customer',
                    full_name: 'Test',
                    quickbooks_customer_id: null,
                    ops_service_addresses: {},
                  },
                  ops_invoices: [
                    {
                      id: 'invoice',
                      status: 'paid',
                      payment_method: 'square',
                      quickbooks_invoice_id: null,
                    },
                  ],
                }
              : { payment_method: 'square', quickbooks_invoice_id: null },
          error: null,
        })
        const q: any = {
          select: () => q,
          eq: () => q,
          in: () => q,
          single: async () => result(),
          update: (patch: Record<string, unknown>) => {
            updates.push({ table, patch })
            return q
          },
          then: (resolve: any, reject: any) =>
            Promise.resolve(result()).then(resolve, reject),
        }
        return q
      },
    })
    await expect(syncAppointmentToQuickBooks('appointment')).rejects.toThrow(
      'network timeout',
    )
    const jobs = updates.filter((u) => u.table === 'ops_quickbooks_sync_jobs')
    expect(jobs).toHaveLength(2)
    expect(
      jobs.every((u) => u.patch.status === 'pending' && u.patch.next_retry_at),
    ).toBe(true)
  })
})
