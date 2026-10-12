import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAddOnBonuses } from '@/lib/ops/add-on-bonuses'
import {
  buildOwnerTimesheets,
  buildTechDayRows,
  buildTechMonthRows,
  timesheetInputAt,
  loadTechPerformance,
  buildTechLaborIssues,
} from './tech-performance'

vi.mock('@/lib/ops/add-on-bonuses', () => ({ loadAddOnBonuses: vi.fn() }))

describe('buildTechLaborIssues', () => {
  it('flags a 24-hour shift without changing its recorded hours or wages', () => {
    const shift = {
      work_date: '2026-10-07',
      payable_minutes: 1493,
      gross_pay: 622.08,
      started_at: '2026-10-07T14:44:28Z',
      ended_at: '2026-10-08T15:37:19Z',
      clock_state: 'complete',
    }
    expect(
      buildTechLaborIssues([shift], new Date('2026-10-12T17:00:00Z')),
    ).toEqual([
      {
        date: '2026-10-07',
        message: expect.stringContaining('exceeds 16 hours'),
      },
    ])
    expect(shift.payable_minutes).toBe(1493)
    expect(shift.gross_pay).toBe(622.08)
  })

  it('flags a long clock window even when breaks reduce paid time below 16 hours', () => {
    expect(
      buildTechLaborIssues(
        [
          {
            work_date: '2026-10-07',
            payable_minutes: 500,
            gross_pay: 200,
            started_at: '2026-10-07T14:44:28Z',
            ended_at: '2026-10-08T15:37:19Z',
            clock_state: 'complete',
          },
        ],
        new Date('2026-10-12T17:00:00Z'),
      ),
    ).toHaveLength(1)
  })

  it('flags unfinished historical shifts while allowing a current live shift and normal closed shift', () => {
    const issues = buildTechLaborIssues(
      [
        {
          work_date: '2026-10-09',
          payable_minutes: 0,
          gross_pay: 0,
          clock_state: 'on_break',
        },
        {
          work_date: '2026-10-12',
          payable_minutes: 0,
          gross_pay: 0,
          clock_state: 'active',
        },
        {
          work_date: '2026-10-08',
          payable_minutes: 480,
          gross_pay: 200,
          clock_state: 'complete',
        },
      ],
      new Date('2026-10-12T17:00:00Z'),
    )
    expect(issues).toEqual([
      { date: '2026-10-09', message: expect.stringContaining('still open') },
    ])
  })
})

describe('buildOwnerTimesheets', () => {
  it('prices only recorded owner job hours at the assumed hourly rate', () => {
    expect(
      buildOwnerTimesheets(
        [
          { appointment_date: '2026-08-04', revenue: 500, hours: 2.5 },
          { appointment_date: '2026-08-06', revenue: 300, hours: 0 },
        ],
        25,
      ),
    ).toEqual([
      {
        work_date: '2026-08-04',
        payable_minutes: 150,
        gross_pay: 62.5,
      },
    ])
  })
})

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
  it('adds earned pay to the loaded estimate without adding gross wages twice', () => {
    const [day] = buildTechDayRows(
      [{ appointment_date: '2026-10-06', revenue: 326, hours: 2 }],
      [{ work_date: '2026-10-06', payable_minutes: 240, gross_pay: 100 }],
      31,
      [
        { work_date: '2026-10-06', pay: 6.6 },
        { work_date: '2026-10-06', pay: 23 },
      ],
    )
    expect(day).toMatchObject({
      grossWages: 100,
      supplementalPay: 29.6,
      laborCostIsEstimate: true,
      laborCost: 153.6,
      profitAfterLaborCost: 172.4,
      profitPerHour: 43.1,
    })
  })

  it('uses actual gross wages plus extras when no loaded estimate is configured', () => {
    const [day] = buildTechDayRows(
      [{ appointment_date: '2026-10-06', revenue: 326, hours: 2 }],
      [{ work_date: '2026-10-06', payable_minutes: 240, gross_pay: 100 }],
      undefined,
      [{ work_date: '2026-10-06', pay: 6.6 }],
    )
    expect(day.laborCost).toBe(106.6)
    expect(day.laborCostIsEstimate).toBe(false)
  })

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
    expect(days[0].laborCost).toBe(100)
    expect(days[0].profitAfterLaborCost).toBe(400)
    expect(days[0].profitPerHour).toBe(100)
    expect(days[1].profitPerHour).toBe(-25)
    expect(days[1].isLive).toBe(true)
    expect(days[2].profitPerHour).toBe(125)
  })
})

describe('buildTechMonthRows', () => {
  it('rounds each shift contribution to cents so daily and monthly sums reconcile', () => {
    const timesheets = Array.from({ length: 5 }, (_, index) => ({
      work_date: `2026-06-0${index + 1}`,
      payable_minutes: 1,
      gross_pay: 0.42,
    }))
    const days = buildTechDayRows([], timesheets, 31)
    const { months, totals } = buildTechMonthRows([], timesheets, 31)
    expect(days.every((day) => day.laborCost === 0.52)).toBe(true)
    expect(months[0].laborCost).toBe(2.6)
    expect(totals.laborCost).toBe(2.6)
  })

  it('floors each loaded contribution at recorded wages before day/month aggregation', () => {
    const timesheets = [
      { work_date: '2026-06-06', payable_minutes: 223, gross_pay: 118.93 },
      { work_date: '2026-06-06', payable_minutes: 60, gross_pay: 25 },
      { work_date: '2026-06-07', payable_minutes: 120, gross_pay: 50 },
      { work_date: '2026-07-01', payable_minutes: 60, gross_pay: 32 },
    ]
    const extras = [
      { work_date: '2026-06-06', pay: 23 },
      { work_date: '2026-07-01', pay: 6.6 },
    ]
    const days = buildTechDayRows([], timesheets, 31, extras)
    const { months, totals } = buildTechMonthRows([], timesheets, 31, extras)
    expect(days.map((day) => day.laborCost)).toEqual([172.93, 62, 38.6])
    expect(months.map((month) => month.laborCost)).toEqual([234.93, 38.6])
    expect(totals.laborCost).toBe(273.53)
    expect(totals.laborCost).toBeCloseTo(
      days.reduce((sum, day) => sum + day.laborCost, 0),
      2,
    )
    expect(totals.laborCost).toBeCloseTo(
      months.reduce((sum, month) => sum + month.laborCost, 0),
      2,
    )
    expect(totals.grossWages).toBe(225.93)
    expect(totals.supplementalPay).toBe(29.6)
    expect(totals.laborCostIsEstimate).toBe(true)
  })

  it('keeps supplemental payments in their work month and includes them in totals', () => {
    const { months, totals } = buildTechMonthRows(
      [],
      [{ work_date: '2026-06-25', payable_minutes: 60, gross_pay: 25 }],
      31,
      [
        { work_date: '2026-06-25', pay: 23 },
        { work_date: '2026-10-06', pay: 6.6 },
      ],
    )
    expect(months[0].laborCost).toBe(54)
    expect(months[1]).toMatchObject({
      month: '2026-10',
      paidHours: 0,
      laborCost: 6.6,
    })
    expect(totals.supplementalPay).toBe(29.6)
    expect(totals.laborCost).toBe(60.6)
  })

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
    expect(june.laborCost).toBe(308)
    expect(june.laborCostPerPaidHour).toBe(22)
    expect(june.revenuePerPaidHour).toBeCloseTo(1000 / 14, 1)
    expect(june.laborPercent).toBeCloseTo(30.8, 1)
    expect(june.billableEfficiency).toBe(50) // 7 job hrs / 14 paid hrs
    expect(june.profitAfterLaborCost).toBe(692)

    expect(totals.jobs).toBe(3)
    expect(totals.revenue).toBe(1500)
    expect(totals.grossWages).toBe(396)
    expect(totals.laborCost).toBe(396)
    expect(totals.profitAfterLaborCost).toBe(1104)
  })

  it('backfills a fully loaded hourly cost without changing payroll records', () => {
    const { months, totals } = buildTechMonthRows(
      [{ appointment_date: '2026-06-12', revenue: 600, hours: 3 }],
      [{ work_date: '2026-06-12', payable_minutes: 240, gross_pay: 92 }],
      31,
    )

    expect(months[0]).toMatchObject({
      grossWages: 92,
      laborCost: 124,
      laborCostPerPaidHour: 31,
      laborPercent: 20.7,
      profitAfterLaborCost: 476,
    })
    expect(totals.laborCost).toBe(124)
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
    expect(months[0].laborCost).toBe(176)
    expect(months[0].profitAfterLaborCost).toBe(-176)
  })
})

describe('loadTechPerformance', () => {
  beforeEach(() => {
    vi.mocked(loadAddOnBonuses).mockReset()
    vi.mocked(loadAddOnBonuses).mockResolvedValue({
      rows: [],
      earnedBonus: 0,
      pendingBonus: 0,
      eligibleRevenue: 0,
    })
  })

  function database(errorTable?: string) {
    const results: Record<string, unknown[]> = {
      staff_users: [
        {
          id: '01d0d46b-29ac-4a27-b953-f5fbc30cf2cd',
          display_name: 'David Gonzalez',
        },
      ],
      ops_appointments: [
        {
          appointment_date: '2026-10-06',
          kind: 'service',
          start_time: '09:00',
          end_time: '11:00',
          quoted_total: 326,
          ops_invoices: { total: 326 },
        },
      ],
      ops_timesheet_entries: [
        {
          work_date: '2026-10-06',
          payable_minutes: 240,
          gross_pay: 100,
          clock_state: 'complete',
        },
      ],
      ops_after_hours_premiums: [{ work_date: '2026-10-06', premium_pay: 23 }],
    }
    const filters = vi.fn()
    const from = vi.fn((table: string) => {
      const result = {
        data: results[table],
        error: table === errorTable ? new Error(`${table} unavailable`) : null,
      }
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        in: filters.mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      }
      return query
    })
    return { client: { from } as unknown as SupabaseClient, filters }
  }

  it('loads saved premiums and only earned bonuses for the technician', async () => {
    const base = {
      key: 'bonus',
      appointmentId: 'appointment',
      appointmentDate: '2026-10-06',
      staffUserId: '01d0d46b-29ac-4a27-b953-f5fbc30cf2cd',
      staffName: 'David Gonzalez',
      customerName: 'Customer',
      category: 'rug_cleaning' as const,
      categoryLabel: 'Rug cleaning',
      eligibleRevenue: 66,
      bonusRate: 0.1,
      bonusAmount: 6.6,
    }
    vi.mocked(loadAddOnBonuses).mockResolvedValue({
      rows: [
        { ...base, status: 'earned' },
        { ...base, key: 'pending', bonusAmount: 10, status: 'pending' },
      ],
      earnedBonus: 6.6,
      pendingBonus: 10,
      eligibleRevenue: 166,
    })
    const { client, filters } = database()
    const [tech] = await loadTechPerformance(client, {
      sinceDate: '2026-10-01',
    })
    expect(filters).toHaveBeenCalledWith('status', ['approved', 'paid'])
    expect(loadAddOnBonuses).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        startDate: '2026-10-01',
        staffUserId: base.staffUserId,
      }),
    )
    expect(tech.totals.laborCost).toBe(153.6)
    expect(tech.days[0].supplementalPay).toBe(29.6)
  })

  it.each([
    'ops_timesheet_entries',
    'ops_after_hours_premiums',
    'ops_appointments',
    'staff_users',
  ])('fails visibly when %s cannot be loaded', async (table) => {
    await expect(loadTechPerformance(database(table).client)).rejects.toThrow(
      `${table} unavailable`,
    )
  })

  it('fails visibly when earned bonuses cannot be loaded', async () => {
    vi.mocked(loadAddOnBonuses).mockRejectedValue(
      new Error('Bonus data unavailable'),
    )
    await expect(loadTechPerformance(database().client)).rejects.toThrow(
      'Bonus data unavailable',
    )
  })
})
