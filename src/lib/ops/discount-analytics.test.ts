import { describe, expect, it } from 'vitest'
import { summarizeDiscountAnalytics } from './discount-analytics'

describe('summarizeDiscountAnalytics', () => {
  it('separates completed, scheduled, coded, automatic, and manual discounts', () => {
    const result = summarizeDiscountAnalytics(
      [
        {
          discount_amount: 50,
          discount_metadata: { promo: { code: 'military' } },
          ops_appointments: {
            appointment_date: '2026-01-10',
            status: 'completed',
          },
        },
        {
          percentage_discount_amount: 18.9,
          percentage_discount_label: 'Multi-rug discount',
          ops_appointments: {
            appointment_date: '2026-01-12',
            status: 'completed',
          },
        },
        {
          discount_amount: 25,
          ops_appointments: {
            appointment_date: '2026-02-10',
            status: 'booked',
          },
        },
        {
          discount_amount: 100,
          ops_appointments: {
            appointment_date: '2026-02-11',
            status: 'cancelled',
          },
        },
      ],
      [
        { code: 'SCC20', use_count: 6, active: true },
        { code: 'MILITARY', use_count: 1, active: true },
        { code: 'UNUSED', use_count: 0, active: true },
      ],
      2026,
    )

    expect(result).toMatchObject({
      discountedInvoices: 3,
      completedInvoices: 2,
      scheduledInvoices: 1,
      totalDiscount: 93.9,
      completedDiscount: 68.9,
      scheduledDiscount: 25,
      averageDiscount: 31.3,
      identifiedInvoices: 2,
      codeTrackedInvoices: 1,
      manualInvoices: 1,
      lifetimeCodeUses: 7,
    })
    expect(result.months[0]).toMatchObject({
      invoiceCount: 2,
      completedAmount: 68.9,
      scheduledAmount: 0,
    })
    expect(result.months[1]).toMatchObject({
      invoiceCount: 1,
      completedAmount: 0,
      scheduledAmount: 25,
    })
    expect(result.breakdown).toEqual([
      {
        label: 'MILITARY',
        kind: 'promo',
        invoiceCount: 1,
        completedInvoices: 1,
        amount: 50,
      },
      {
        label: 'Manual / unlabeled',
        kind: 'manual',
        invoiceCount: 1,
        completedInvoices: 0,
        amount: 25,
      },
      {
        label: 'Multi-rug discount',
        kind: 'automatic',
        invoiceCount: 1,
        completedInvoices: 1,
        amount: 18.9,
      },
    ])
    expect(result.promoCodes).toEqual([
      { code: 'SCC20', useCount: 6, active: true },
      { code: 'MILITARY', useCount: 1, active: true },
    ])
  })

  it('returns a complete empty year', () => {
    const result = summarizeDiscountAnalytics([], [], 2026)

    expect(result.discountedInvoices).toBe(0)
    expect(result.totalDiscount).toBe(0)
    expect(result.averageDiscount).toBe(0)
    expect(result.breakdown).toEqual([])
    expect(result.months).toHaveLength(12)
  })

  it('does not hide the automatic portion of a mixed discount', () => {
    const result = summarizeDiscountAnalytics(
      [
        {
          discount_amount: 46,
          percentage_discount_amount: 16,
          percentage_discount_label: 'Multi-rug discount',
          ops_appointments: {
            appointment_date: '2026-06-01',
            status: 'completed',
          },
        },
      ],
      [],
      2026,
    )

    expect(result.breakdown).toEqual([
      {
        label: 'Manual + Multi-rug discount',
        kind: 'manual',
        invoiceCount: 1,
        completedInvoices: 1,
        amount: 62,
      },
    ])
    expect(result.manualInvoices).toBe(1)
    expect(result.identifiedInvoices).toBe(0)
  })
})
