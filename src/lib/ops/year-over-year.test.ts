import { describe, expect, it } from 'vitest'
import { summarizeYearOverYear } from './year-over-year'

/** Build n invoices dated in a given year, all on the same day. */
const rows = (year: number, monthDay: string, count: number, each: number) =>
  Array.from({ length: count }, () => ({
    txn_date: `${year}-${monthDay}`,
    total: each,
  }))

describe('summarizeYearOverYear', () => {
  it('compares the same calendar point across years, not full vs partial', () => {
    const data = [
      // 2025: 30 invoices in March, 30 more in October (after today's date)
      ...rows(2025, '03-15', 30, 100),
      ...rows(2025, '10-15', 30, 100),
      // 2026: 30 invoices in March only
      ...rows(2026, '03-15', 30, 200),
    ]
    const s = summarizeYearOverYear(data, '2026-07-19')

    const y2025 = s.years.find((y) => y.year === 2025)!
    const y2026 = s.years.find((y) => y.year === 2026)!

    expect(y2025.fullYear).toBe(6000)
    // Only the March half counts toward the same-period figure.
    expect(y2025.throughToday).toBe(3000)
    expect(y2026.throughToday).toBe(6000)

    // Doubling revenue at the same point = +100%, even though 2026's full
    // year total currently equals 2025's.
    expect(s.ytdGrowthPct).toBe(100)
    expect(s.priorYtd).toBe(3000)
    expect(s.priorFullYear).toBe(6000)
    expect(s.pctOfPriorFullYear).toBe(100)
  })

  it('includes invoices dated exactly on today', () => {
    const s = summarizeYearOverYear(rows(2026, '07-19', 25, 40), '2026-07-19')
    expect(s.ytd).toBe(1000)
  })

  it('excludes invoices dated later in the year', () => {
    const s = summarizeYearOverYear(rows(2026, '07-20', 25, 40), '2026-07-19')
    expect(s.ytd).toBe(0)
    expect(s.years[0].fullYear).toBe(1000)
  })

  it('drops years too sparse to chart', () => {
    const s = summarizeYearOverYear(
      [...rows(2021, '08-01', 9, 165), ...rows(2026, '03-01', 30, 100)],
      '2026-07-19',
    )
    expect(s.years.map((y) => y.year)).toEqual([2026])
  })

  it('computes average ticket per year', () => {
    const s = summarizeYearOverYear(rows(2026, '03-01', 25, 400), '2026-07-19')
    expect(s.years[0].avgTicket).toBe(400)
  })

  it('handles having no prior year to compare against', () => {
    const s = summarizeYearOverYear(rows(2026, '03-01', 30, 100), '2026-07-19')
    expect(s.ytdGrowthPct).toBeNull()
    expect(s.priorYtd).toBe(0)
    expect(s.pctOfPriorFullYear).toBeNull()
  })

  it('median ignores a few huge commercial invoices that skew the mean', () => {
    // 20 typical $300 jobs + 2 giant $6,000 commercial invoices
    const data = [
      ...rows(2026, '03-01', 20, 300),
      ...rows(2026, '03-02', 2, 6000),
    ]
    const s = summarizeYearOverYear(data, '2026-07-19')
    const y = s.years[0]
    // Mean is dragged far above what a typical job is worth...
    expect(y.avgTicket).toBeGreaterThan(800)
    // ...but the median still reports the real typical job.
    expect(y.medianTicket).toBe(300)
  })

  it('handles an empty dataset', () => {
    const s = summarizeYearOverYear([], '2026-07-19')
    expect(s.years).toEqual([])
    expect(s.ytd).toBe(0)
    expect(s.ytdGrowthPct).toBeNull()
  })
})
