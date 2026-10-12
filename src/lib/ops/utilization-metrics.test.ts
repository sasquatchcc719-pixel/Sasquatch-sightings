import { describe, expect, it } from 'vitest'
import {
  appointmentDisplayRevenue,
  appointmentScheduleRevenue,
  effectiveInvoiceAmount,
  excludeJobsCoveredByRevenueEntries,
} from './utilization-metrics'

describe('effectiveInvoiceAmount', () => {
  it('keeps a fully discounted invoice at zero despite positive lines and quote', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: 0,
        invoiceLineItems: [{ line_total: 240 }],
        quotedTotal: 240,
        kind: 'service',
      }),
    ).toBe(0)
  })

  it('prefers invoice total over quote', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: 4052.46,
        quotedTotal: 4752.46,
      }),
    ).toBe(4052.46)
  })

  it('falls back to quote for ordinary jobs without an invoice', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: null,
        quotedTotal: 350,
        kind: 'service',
      }),
    ).toBe(350)
  })

  it('does not count restoration quote as revenue without an invoice', () => {
    // Benns mitigation visit: project estimate on the calendar, no invoice yet.
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: null,
        quotedTotal: 3897.08,
        kind: 'restoration',
      }),
    ).toBe(0)
  })

  it('never counts an estimate as revenue', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: null,
        invoiceLineItems: [{ line_total: 1049.94 }],
        quotedTotal: 1049.94,
        kind: 'estimate',
      }),
    ).toBe(0)
  })

  it('counts the restoration closing invoice once', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: 4052.46,
        quotedTotal: 4752.46,
        kind: 'restoration',
      }),
    ).toBe(4052.46)
  })
})

describe('excludeJobsCoveredByRevenueEntries', () => {
  it('counts a linked invoice once and keeps unrelated or legacy jobs', () => {
    const jobs = [
      { id: 'duplicate', ops_invoice_id: 'invoice-1' },
      { id: 'unique', ops_invoice_id: 'invoice-2' },
      { id: 'legacy', ops_invoice_id: null },
    ]
    const entries = [{ ops_invoice_id: 'invoice-1' }]

    expect(excludeJobsCoveredByRevenueEntries(jobs, entries)).toEqual([
      { id: 'unique', ops_invoice_id: 'invoice-2' },
      { id: 'legacy', ops_invoice_id: null },
    ])
  })
})

describe('appointmentScheduleRevenue', () => {
  it('shows and reports zero for a fully discounted invoice', () => {
    const appointment = {
      kind: 'service',
      quoted_total: 240,
      ops_invoices: {
        total: 0,
        ops_invoice_line_items: [{ line_total: 240 }],
      },
    }

    expect(appointmentDisplayRevenue(appointment)).toBe(0)
    expect(appointmentScheduleRevenue(appointment)).toBe(0)
  })

  it('keeps an estimate value visible without counting it as revenue', () => {
    const estimate = {
      kind: 'estimate',
      quoted_total: 1049.94,
      ops_appointment_line_items: [{ line_total: 1049.94 }],
    }

    expect(appointmentDisplayRevenue(estimate)).toBe(1049.94)
    expect(appointmentScheduleRevenue(estimate)).toBe(0)
  })

  it('counts ordinary service appointments', () => {
    expect(
      appointmentScheduleRevenue({
        kind: 'service',
        quoted_total: 230,
      }),
    ).toBe(230)
  })
})
