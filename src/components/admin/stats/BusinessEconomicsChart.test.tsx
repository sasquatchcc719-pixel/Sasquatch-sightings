// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  filterBusinessCostSnapshots,
  type BusinessCostSnapshot,
} from './BusinessEconomicsChart'

function snapshot(windowEnd: string): BusinessCostSnapshot {
  return {
    periodKind: 'weekly',
    windowStart: windowEnd,
    windowEnd,
    capturedAt: `${windowEnd}T12:00:00Z`,
    revenue: 1000,
    productiveHours: 10,
    quickbooksCost: 400,
    excludedBookkeepingAdjustments: 0,
    ownerFieldHours: 0,
    ownerReplacementCost: 0,
    revenuePerHour: 100,
    bookCostPerHour: 40,
    ownerAdjustedCostPerHour: 40,
    bookCostPct: 40,
    ownerAdjustedCostPct: 40,
    ownerAdjustedMarginPct: 60,
    expenseBreakdown: {},
  }
}

describe('business economics chart ranges', () => {
  const snapshots = [
    snapshot('2025-12-31'),
    snapshot('2026-01-07'),
    snapshot('2026-06-24'),
    snapshot('2026-07-01'),
    snapshot('2026-08-26'),
    snapshot('2026-09-02'),
    snapshot('2026-09-23'),
  ]

  it('shows only the trailing 30 or 90 days when selected', () => {
    expect(
      filterBusinessCostSnapshots(snapshots, '30d').map(
        (item) => item.windowEnd,
      ),
    ).toEqual(['2026-08-26', '2026-09-02', '2026-09-23'])
    expect(
      filterBusinessCostSnapshots(snapshots, '90d').map(
        (item) => item.windowEnd,
      ),
    ).toEqual(['2026-07-01', '2026-08-26', '2026-09-02', '2026-09-23'])
  })

  it('keeps the calendar-year view inside the latest reading year', () => {
    expect(
      filterBusinessCostSnapshots(snapshots, 'year').map(
        (item) => item.windowEnd,
      ),
    ).toEqual([
      '2026-01-07',
      '2026-06-24',
      '2026-07-01',
      '2026-08-26',
      '2026-09-02',
      '2026-09-23',
    ])
  })
})
