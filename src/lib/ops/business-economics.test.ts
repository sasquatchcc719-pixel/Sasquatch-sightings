// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildBusinessCostReportCard,
  buildBusinessCostDigest,
  calculateBusinessCostSnapshot,
  latestCompletedWednesday,
  weeklyCostWindowsSince,
  yearToDateCostWindow,
} from './business-economics'

describe('business economics', () => {
  it('builds discrete Thursday-through-Wednesday weeks and a YTD window', () => {
    const now = new Date('2026-09-24T16:00:00Z')
    expect(latestCompletedWednesday(now)).toBe('2026-09-23')
    const windows = weeklyCostWindowsSince('2026-09-10', now)
    expect(windows).toEqual([
      { start: '2026-09-10', end: '2026-09-16' },
      { start: '2026-09-17', end: '2026-09-23' },
    ])
    expect(yearToDateCostWindow(now)).toEqual({
      start: '2026-01-01',
      end: '2026-09-23',
    })
  })

  it('keeps book cost separate and adds only owner field replacement labor', () => {
    const snapshot = calculateBusinessCostSnapshot({
      periodKind: 'weekly',
      window: { start: '2026-09-17', end: '2026-09-23' },
      revenue: 20000,
      productiveHours: 100,
      quickbooksCost: 6000,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 20,
      expenseBreakdown: { Payroll: 3000 },
      capturedAt: '2026-09-24T16:00:00.000Z',
    })

    expect(snapshot.revenuePerHour).toBe(200)
    expect(snapshot.bookCostPerHour).toBe(60)
    expect(snapshot.ownerReplacementCost).toBe(620)
    expect(snapshot.ownerAdjustedCostPerHour).toBe(66.2)
    expect(snapshot.ownerAdjustedCostPct).toBe(33.1)
    expect(snapshot.ownerAdjustedMarginPct).toBe(66.9)
  })

  it('uses only actual QuickBooks costs in the Telegram report', () => {
    const previous = calculateBusinessCostSnapshot({
      periodKind: 'weekly',
      window: { start: '2026-09-10', end: '2026-09-16' },
      revenue: 20000,
      productiveHours: 100,
      quickbooksCost: 5800,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 20,
      expenseBreakdown: {},
    })
    const snapshot = calculateBusinessCostSnapshot({
      periodKind: 'weekly',
      window: { start: '2026-09-17', end: '2026-09-23' },
      revenue: 20000,
      productiveHours: 100,
      quickbooksCost: 6000,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 20,
      expenseBreakdown: {},
    })
    const yearToDate = calculateBusinessCostSnapshot({
      periodKind: 'year_to_date',
      window: { start: '2026-01-01', end: '2026-09-23' },
      revenue: 170000,
      productiveHours: 1000,
      quickbooksCost: 70000,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 300,
      expenseBreakdown: {},
    })
    const digest = buildBusinessCostDigest([previous, snapshot], yearToDate)
    expect(digest).toContain('Weekly Business Cost Report')
    expect(digest).toContain('Work completed: $20000.00 revenue')
    expect(digest).toContain('QuickBooks cost/hour: $60.00')
    expect(digest).toContain('cost/hour +$2.00')
    expect(digest).toContain('2026 YEAR-TO-DATE AVERAGE')
    expect(digest).toContain('QuickBooks cost/hour: $70.00')
    expect(digest).toContain('No owner-labor estimate')
    expect(digest).toContain('owner draws')
    expect(digest).not.toContain('Owner-adjusted')

    const report = buildBusinessCostReportCard([previous, snapshot], yearToDate)
    expect(report?.card.title).toBe('Income vs. cost')
    expect(report?.card.incomeCostSeries?.points).toEqual([
      { label: 'Sep 16', income: 200, cost: 58 },
      { label: 'Sep 23', income: 200, cost: 60 },
    ])
    expect(report?.caption).toContain('Latest margin 70.0%')
    expect(report?.card.footer).not.toContain('$31')
  })
})
