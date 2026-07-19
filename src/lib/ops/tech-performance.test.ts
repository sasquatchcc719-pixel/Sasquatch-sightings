import { describe, expect, it } from 'vitest'
import {
  buildTechDayRows,
  buildTechMonthRows,
  timesheetInputAt,
} from './tech-performance'

describe('timesheetInputAt', () => {
  it('calculates live paid time and wages for an open shift', () => {
    const timesheet = timesheetInputAt(
      {
        work_date: '2026-07-16',
        payable_minutes: 0,
        gross_pay: 0,
        started_at: '2026-07-16T14:00:00.000Z',
        break_minutes: 15,
        hourly_rate: 24,
        clock_state: 'on_break',
        break_started_at: '2026-07-16T16:45:00.000Z',
      },
      new Date('2026-07-16T17:00:00.000Z'),
    )

    expect(timesheet.payable_minutes).toBe(150)
    expect(timesheet.gross_pay).toBe(60)
    expect(timesheet.isLive).toBe(true)
  })
})

describe('buildTechDayRows', () => {
  it('computes profit per hour for each calendar day', () => {
    const days = buildTechDayRows(
      [
        { appointment_date: '2026-07-14', revenue: 300, hours: 2 },
        { appointment_date: '2026-07-14', revenue: 200, hours: 1.5 },
        { appointment_date: '2026-07-16', revenue: 250, hours: 2 },
      ],
      [
        { work_date: '2026-07-14', payable_minutes: 240, gross_pay: 100 },
        {
          work_date: '2026-07-15',
          payable_minutes: 120,
          gross_pay: 50,
          isLive: true,
        },
      ],
    )

    expect(days.map((day) => day.date)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ])
    expect(days[0].jobs).toBe(2)
    expect(days[0].profitAfterWages).toBe(400)
    expect(days[0].profitPerHour).toBe(100)
    expect(days[1].profitPerHour).toBe(-25)
    expect(days[1].isLive).toBe(true)
    expect(days[2].profitPerHour).toBe(125)
  })
})

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
