import { describe, expect, it } from 'vitest'
import {
  appointmentDisplayRevenue,
  appointmentScheduleRevenue,
  effectiveInvoiceAmount,
} from './utilization-metrics'

describe('effectiveInvoiceAmount', () => {
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
        invoiceTotal: 0,
        quotedTotal: 350,
        kind: 'service',
      }),
    ).toBe(350)
  })

  it('does not count restoration quote as revenue without an invoice', () => {
    // Benns mitigation visit: project estimate on the calendar, no invoice yet.
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: 0,
        quotedTotal: 3897.08,
        kind: 'restoration',
      }),
    ).toBe(0)
  })

  it('never counts an estimate as revenue', () => {
    expect(
      effectiveInvoiceAmount({
        invoiceTotal: 0,
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

describe('appointmentScheduleRevenue', () => {
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
