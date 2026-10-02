import { describe, expect, it } from 'vitest'
import { getInvoiceReconciliationAction } from '@/lib/ops/quickbooks-sync-reconciliation'

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
