// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  businessLaborSummary,
  loadRecordedBusinessLabor,
  type RecordedLaborRow,
} from './business-labor'
vi.mock('./add-on-bonuses', () => ({
  loadAddOnBonuses: vi.fn(async () => ({ rows: [], earnedBonus: 0 })),
}))

const snapshot = {
  windowStart: '2026-10-01',
  windowEnd: '2026-10-07',
  revenue: 4000,
  productiveHours: 40,
  quickbooksCost: 800,
  expenseBreakdown: {
    'Payroll expenses / Wages': 500,
    'Payroll expenses / Workers Comp Insurance': 50,
    'Vehicle expenses / Fuel': 250,
  },
}
const labor: RecordedLaborRow[] = [
  {
    date: '2026-10-07',
    paidHours: 20,
    grossWages: 600,
    extraPay: 20,
    entries: 1,
    issues: [],
  },
]
describe('business payroll reconciliation', () => {
  it('replaces booked wages with earned wages and extras exactly once, retaining insurance and other expenses', () => {
    const result = businessLaborSummary(snapshot, labor)
    expect(result).toMatchObject({
      recordedLabor: 620,
      recordedPaidHours: 20,
      bookedWages: 500,
      otherBookCosts: 300,
      trackedCost: 920,
      trackedCostPerHour: 23,
      trackedMarginPct: 77,
    })
  })
  it('counts labor even in a week with no paycheck posted to QuickBooks', () => {
    expect(
      businessLaborSummary(
        { ...snapshot, quickbooksCost: 250, expenseBreakdown: { Fuel: 250 } },
        labor,
      ).trackedCost,
    ).toBe(870)
  })
  it('retains booked wages when no timeclock record exists', () => {
    const result = businessLaborSummary(snapshot, [])
    expect(result.trackedCost).toBe(800)
    expect(result.usesRecordedPayroll).toBe(false)
  })
  it('retains real wages before timeclock coverage instead of dropping older payroll', () => {
    expect(
      businessLaborSummary({ ...snapshot, retainedBookWages: 200 }, labor)
        .trackedCost,
    ).toBe(1120)
  })
  it('includes only labor within the same reporting window and retains warnings without altering recorded wages', () => {
    const result = businessLaborSummary(snapshot, [
      ...labor,
      { ...labor[0], date: '2026-09-30', grossWages: 999 },
      {
        ...labor[0],
        date: '2026-10-03',
        grossWages: 700,
        issues: ['Review overnight shift'],
      },
    ])
    expect(result.recordedLabor).toBe(1340)
    expect(result.laborIssues).toEqual(['Review overnight shift'])
  })
  it('loads closed draft shifts as recorded labor and flags suspicious durations', async () => {
    const from = vi.fn((table: string) => {
      const result = {
        error: null,
        data:
          table === 'ops_timesheet_entries'
            ? [
                {
                  work_date: '2026-10-07',
                  started_at: '2026-10-07T14:44:00Z',
                  ended_at: '2026-10-08T15:37:00Z',
                  payable_minutes: 1493,
                  gross_pay: 622.08,
                  clock_state: 'complete',
                  staff_users: { display_name: 'David' },
                },
              ]
            : [],
      }
      return {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown) => resolve(result),
      }
    })
    const [row] = await loadRecordedBusinessLabor(
      { from } as never,
      '2026-10-01',
      '2026-10-07',
    )
    expect(row.grossWages).toBe(622.08)
    expect(row.issues[0]).toContain('exceeds 16 hours')
  })
})
