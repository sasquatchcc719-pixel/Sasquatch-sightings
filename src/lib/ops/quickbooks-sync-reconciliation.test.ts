import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ excludeCash: vi.fn() }))
vi.mock('@/lib/quickbooks-api', () => ({
  excludeCashInvoiceFromQuickBooks: mocks.excludeCash,
}))
import {
  getInvoiceReconciliationAction,
  reconcileMissingInvoiceQuickBooksJobs,
} from '@/lib/ops/quickbooks-sync-reconciliation'

const appointment = {
  id: 'appointment-1',
  status: 'completed',
  kind: 'service',
  visit_type: null,
  restoration_project_id: null,
  recurring_template_id: null,
}

const invoice = {
  id: 'invoice-1',
  status: 'paid',
  sync_status: 'pending',
  payment_method: 'square',
  quickbooks_invoice_id: null,
  ops_appointments: appointment,
}

const context = {
  hasBlockingJob: false,
  isInBatchInvoice: false,
  recurringInvoiceMode: null,
}

type ExclusionOverride = {
  invoice?: Partial<Parameters<typeof getInvoiceReconciliationAction>[0]>
  appointment?: Partial<
    NonNullable<Parameters<typeof getInvoiceReconciliationAction>[1]>
  >
}

describe('QuickBooks invoice reconciliation policy', () => {
  it('queues the reported failure shape: a paid Square invoice with no job', () => {
    expect(
      getInvoiceReconciliationAction(
        invoice,
        { ...appointment, status: 'on_my_way' },
        context,
      ),
    ).toBe('queue')
  })

  it('promotes a completed job whose invoice is still draft', () => {
    expect(
      getInvoiceReconciliationAction(
        { ...invoice, status: 'draft', sync_status: 'held' },
        appointment,
        context,
      ),
    ).toBe('promote')
  })

  it.each([
    ['an appointment already billed in a batch', { isInBatchInvoice: true }],
    ['monthly batch billing', { recurringInvoiceMode: 'batch_monthly' }],
    ['an active or failed queue job', { hasBlockingJob: true }],
  ])('does not duplicate %s', (_label, override) => {
    expect(
      getInvoiceReconciliationAction(invoice, appointment, {
        ...context,
        ...override,
      }),
    ).toBeNull()
  })

  const exclusions: Array<[string, ExclusionOverride]> = [
    ['cash', { invoice: { payment_method: 'cash' } }],
    ['an estimate', { appointment: { kind: 'estimate' } }],
    ['restoration work', { appointment: { kind: 'restoration' } }],
    ['an intentionally held invoice', { invoice: { sync_status: 'held' } }],
    [
      'an already synced invoice',
      { invoice: { quickbooks_invoice_id: '6900' } },
    ],
  ]

  it.each(exclusions)('does not queue %s', (_label, override) => {
    expect(
      getInvoiceReconciliationAction(
        { ...invoice, ...(override.invoice || {}) },
        { ...appointment, ...(override.appointment || {}) },
        context,
      ),
    ).toBeNull()
  })
})

describe('recurring cash cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.excludeCash.mockResolvedValue(true)
  })

  function db(cashError: Error | null = null) {
    return {
      from() {
        let isCashScan = false
        const builder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((column: string, value: string) => {
            if (column === 'payment_method' && value === 'cash')
              isCashScan = true
            return builder
          }),
          not: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: isCashScan ? [{ id: 'cash-a' }, { id: 'cash-b' }] : [],
              error: isCashScan ? cashError : null,
            }).then(resolve),
        }
        return builder
      },
    } as unknown as SupabaseClient
  }

  it('repairs existing linked cash invoices even without a pending sync job', async () => {
    const supabase = db()
    await reconcileMissingInvoiceQuickBooksJobs(supabase)
    expect(mocks.excludeCash.mock.calls).toEqual([
      [supabase, 'cash-a'],
      [supabase, 'cash-b'],
    ])
  })

  it('continues cleanup after a void fails so the next scan can retry it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.excludeCash.mockRejectedValueOnce(new Error('QBO unavailable'))
    await expect(
      reconcileMissingInvoiceQuickBooksJobs(db()),
    ).resolves.toMatchObject({ inspected: 0 })
    expect(mocks.excludeCash).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('cleanup failed'),
      'cash-a',
      expect.any(Error),
    )
    log.mockRestore()
  })

  it('reports a failed cash scan instead of silently skipping it', async () => {
    await expect(
      reconcileMissingInvoiceQuickBooksJobs(
        db(new Error('database unavailable')),
      ),
    ).rejects.toThrow('database unavailable')
  })
})
