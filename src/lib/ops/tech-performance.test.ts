import { describe, expect, it } from 'vitest'
import { buildTechMonthRows } from './tech-performance'

describe('buildTechMonthRows', () => {
  it('groups revenue/hours and wages by month and computes ratios', () => {
    const { months, totals } = buildTechMonthRows(
      [
        { appointment_date: '2026-06-12', revenue: 400, hours: 3 },
        { appointment_date: '2026-06-20', revenue: 600, hours: 4 },
        { appointment_date: '2026-07-02', revenue: 500, hours: 2.5 },
      ],
      [
        { work_date: '2026-06-12', payable_minutes: 480, gross_pay: 176 },
        { work_date: '2026-06-20', payable_minutes: 360, gross_pay: 132 },
        { work_date: '2026-07-02', payable_minutes: 240, gross_pay: 88 },
      ],
    )

    expect(months).toHaveLength(2)
    const june = months[0]
    expect(june.month).toBe('2026-06')
    expect(june.jobs).toBe(2)
    expect(june.revenue).toBe(1000)
    expect(june.paidHours).toBe(14)
    expect(june.grossWages).toBe(308)
    expect(june.revenuePerPaidHour).toBeCloseTo(1000 / 14, 1)
    expect(june.laborPercent).toBeCloseTo(30.8, 1)
    expect(june.billableEfficiency).toBe(50) // 7 job hrs / 14 paid hrs
    expect(june.profitAfterWages).toBe(692)

    expect(totals.jobs).toBe(3)
    expect(totals.revenue).toBe(1500)
    expect(totals.grossWages).toBe(396)
    expect(totals.profitAfterWages).toBe(1104)
  })

  it('falls back to job hours for revenue-per-hour when no timesheets exist', () => {
    const { months } = buildTechMonthRows(
      [{ appointment_date: '2026-06-12', revenue: 300, hours: 2 }],
      [],
    )
    expect(months[0].revenuePerPaidHour).toBe(150)
    expect(months[0].paidHours).toBe(0)
    expect(months[0].billableEfficiency).toBe(0)
    expect(months[0].laborPercent).toBe(0)
  })

  it('keeps months with timesheets but no completed jobs (training weeks)', () => {
    const { months } = buildTechMonthRows(
      [],
      [{ work_date: '2026-05-20', payable_minutes: 480, gross_pay: 176 }],
    )
    expect(months).toHaveLength(1)
    expect(months[0].revenue).toBe(0)
    expect(months[0].grossWages).toBe(176)
    expect(months[0].profitAfterWages).toBe(-176)
  })
})
