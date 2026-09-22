import { describe, expect, it } from 'vitest'
import {
  buildMonthlyRestorationSnapshot,
  attachmentRollup,
  effectiveBillingMode,
  monthStart,
  reconcileBatchAmounts,
  reportSha256,
  restorationReportStoragePath,
} from './monthly-restoration-billing'

describe('monthly restoration billing snapshots', () => {
  it('lets the customer policy override a mistakenly per-visit template', () => {
    expect(effectiveBillingMode('monthly_consolidated', 'per_visit')).toBe(
      'monthly_consolidated',
    )
    expect(effectiveBillingMode('immediate', 'per_visit')).toBe('immediate')
    expect(effectiveBillingMode('immediate', 'batch_monthly')).toBe(
      'monthly_consolidated',
    )
  })

  it('does not call a partially attached invoice sent', () => {
    expect(attachmentRollup(['attached', 'failed'])).toBe('partial')
    expect(attachmentRollup(['attached', 'attached'])).toBe('complete')
    expect(attachmentRollup([])).toBe('not_required')
  })
  it('assigns close work to the close month', () => {
    expect(monthStart('2026-09-21')).toBe('2026-09-01')
  })

  it('preserves gross charges and applies deductible then deposit once', () => {
    const snapshot = buildMonthlyRestorationSnapshot({
      projectId: 'project-1',
      customerId: 'customer-1',
      serviceDate: '2026-09-21',
      serviceAddress: '443 Highway 105, Palmer Lake, CO 80133',
      closedAt: '2026-09-21T18:00:00Z',
      charges: [],
      grossSubtotal: 2_000,
      deductibleCredit: 500,
      depositCents: 100_000,
      refundDueCents: 0,
    })

    expect(snapshot.grossSubtotal).toBe(2_000)
    expect(snapshot.deductibleCredit).toBe(500)
    expect(snapshot.depositApplied).toBe(1_000)
    expect(snapshot.invoiceDiscount).toBe(1_500)
    expect(snapshot.amountDue).toBe(500)
  })

  it('caps an overpayment at the invoice amount while retaining refund due', () => {
    const snapshot = buildMonthlyRestorationSnapshot({
      projectId: 'project-1',
      customerId: 'customer-1',
      serviceDate: '2026-09-21',
      serviceAddress: '443 Highway 105, Palmer Lake, CO 80133',
      closedAt: '2026-09-21T18:00:00Z',
      charges: [],
      grossSubtotal: 900,
      deductibleCredit: 0,
      depositCents: 100_000,
      refundDueCents: 10_000,
    })

    expect(snapshot.depositApplied).toBe(900)
    expect(snapshot.amountDue).toBe(0)
    expect(snapshot.refundDueCents).toBe(10_000)
  })

  it('reconciles mixed appointment and restoration entries exactly', () => {
    const snapshot = buildMonthlyRestorationSnapshot({
      projectId: 'project-1',
      customerId: 'customer-1',
      serviceDate: '2026-09-21',
      serviceAddress: '443 Highway 105, Palmer Lake, CO 80133',
      closedAt: '2026-09-21T18:00:00Z',
      charges: [],
      grossSubtotal: 2_000,
      deductibleCredit: 500,
      depositCents: 25_000,
      refundDueCents: 0,
    })

    expect(
      reconcileBatchAmounts({
        appointmentSubtotals: [125.25, 74.75],
        restorationSnapshots: [snapshot],
      }),
    ).toEqual({ subtotal: 2_200, discountAmount: 750, total: 1_450 })
  })

  it('uses stable report paths and checksums', () => {
    expect(
      restorationReportStoragePath({
        customerId: 'customer-1',
        projectId: 'project-1',
      }),
    ).toBe('customer-1/project-1/final-v1.pdf')
    expect(reportSha256(Buffer.from('same report'))).toBe(
      reportSha256(Buffer.from('same report')),
    )
  })
})
