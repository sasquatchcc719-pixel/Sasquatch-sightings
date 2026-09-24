// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildBusinessCostDigest,
  calculateBusinessCostSnapshot,
  latestCompletedWednesday,
  rollingCostWindowsSince,
} from './business-economics'

describe('business economics', () => {
  it('builds completed 28-day windows ending Wednesday', () => {
    const now = new Date('2026-09-24T16:00:00Z')
    expect(latestCompletedWednesday(now)).toBe('2026-09-23')
    const windows = rollingCostWindowsSince('2026-08-27', now)
    expect(windows).toEqual([{ start: '2026-08-27', end: '2026-09-23' }])
  })

  it('keeps book cost separate and adds only owner field replacement labor', () => {
    const snapshot = calculateBusinessCostSnapshot({
      window: { start: '2026-08-27', end: '2026-09-23' },
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

  it('states exactly what the Telegram report includes and excludes', () => {
    const previous = calculateBusinessCostSnapshot({
      window: { start: '2026-08-20', end: '2026-09-16' },
      revenue: 20000,
      productiveHours: 100,
      quickbooksCost: 5800,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 20,
      expenseBreakdown: {},
    })
    const snapshot = calculateBusinessCostSnapshot({
      window: { start: '2026-08-27', end: '2026-09-23' },
      revenue: 20000,
      productiveHours: 100,
      quickbooksCost: 6000,
      excludedBookkeepingAdjustments: 0,
      ownerFieldHours: 20,
      expenseBreakdown: {},
    })
    const digest = buildBusinessCostDigest([previous, snapshot])
    expect(digest).toContain('QuickBooks cost/hour: $60.00')
    expect(digest).toContain('Owner-adjusted cost/hour: $66.20')
    expect(digest).toContain('cost/hour +$2.00')
    expect(digest).toContain('No estimated depreciation')
    expect(digest).toContain('owner draws')
  })
})
