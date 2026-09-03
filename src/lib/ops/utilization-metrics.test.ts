import { describe, expect, it } from 'vitest'
import { effectiveInvoiceAmount } from './utilization-metrics'

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
