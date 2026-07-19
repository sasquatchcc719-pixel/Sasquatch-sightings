import { describe, expect, it } from 'vitest'
import { projectAnnualRevenue } from './revenue-projection'

const FLAT = new Array(12).fill(1 / 12)
const NONE = new Array(12).fill(0)

/** Sasquatch 2026 shape: solo owner Jan–Apr, second tech from May. */
const REAL_2026 = [
  11602, 11570, 8431, 15364, 27382, 28407, 16562, 0, 0, 0, 0, 0,
]

/** Seasonality learned from 2023–2025 QuickBooks history. */
const REAL_SEASONALITY = [
  0.0647, 0.047, 0.0521, 0.0674, 0.0894, 0.1194, 0.0832, 0.1163, 0.0846, 0.0915,
  0.0918, 0.0925,
]

describe('projectAnnualRevenue', () => {
  it('does not drag the forecast down with pre-hire months', () => {
    const p = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-16',
    })

    const ytd = REAL_2026.reduce((s, v) => s + v, 0)
    // The old model averaged the whole year to date and multiplied out,
    // landing near $210k. Using only the two-tech months must beat that.
    const oldNaive = (ytd / 28.7) * 48
    expect(p.projectedAnnual).toBeGreaterThan(oldNaive)
    expect(p.ytdActual).toBe(ytd)
    expect(p.method).toBe('seasonal')
    // Run rate comes from May–Jul only.
    expect(p.recentWindowLabel).toBe('May–Jul')
  })

  it('weights the rest of the year by real seasonality, not equal months', () => {
    const seasonal = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-16',
    })
    const flat = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: FLAT,
      today: '2026-07-16',
    })
    // Aug–Dec really are a bigger slice of the year than 5/12 of it.
    expect(seasonal.remainingShare).toBeGreaterThan(flat.remainingShare)
    // But June is also a seasonal peak (11.9% of a year vs 8.3% if flat), so
    // the seasonal model must NOT treat June's spike as the new baseline —
    // it discounts the run rate accordingly and lands below the naive model.
    expect(seasonal.annualizedRunRate).toBeLessThan(flat.annualizedRunRate)
    expect(seasonal.projectedAnnual).toBeLessThan(flat.projectedAnnual)
  })

  it('treats booked calendar work as a floor', () => {
    const booked = new Array(12).fill(0)
    booked[8] = 500000 // absurd amount already contracted in September
    const p = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: booked,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-16',
    })
    expect(p.bookedIsFloor).toBe(true)
    expect(p.projectedRemainder).toBe(500000)
    expect(p.projectedAnnual).toBe(p.ytdActual + 500000)
  })

  it('ignores booked work already in the past', () => {
    const booked = new Array(12).fill(0)
    booked[0] = 99999 // January, long gone
    const p = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: booked,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-16',
    })
    expect(p.bookedRemainder).toBe(0)
  })

  it('falls back to a linear model with no history', () => {
    const p = projectAnnualRevenue({
      monthlyCompleted: [1000, 1000, 1000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      monthlyBooked: NONE,
      seasonality: null,
      today: '2026-03-31',
    })
    expect(p.method).toBe('linear')
    // 3 months at 1000/mo → 12000/yr
    expect(p.projectedAnnual).toBeCloseTo(12000, -2)
  })

  it('rejects malformed seasonality and degrades to linear', () => {
    const p = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: [0.5, 0.5], // wrong length
      today: '2026-07-16',
    })
    expect(p.method).toBe('linear')
  })

  it('prorates the current month rather than counting it whole', () => {
    const early = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-02',
    })
    const late = projectAnnualRevenue({
      monthlyCompleted: REAL_2026,
      monthlyBooked: NONE,
      seasonality: REAL_SEASONALITY,
      today: '2026-07-30',
    })
    expect(early.remainingShare).toBeGreaterThan(late.remainingShare)
  })

  it('handles a brand-new year with no revenue yet', () => {
    const p = projectAnnualRevenue({
      monthlyCompleted: NONE,
      monthlyBooked: NONE,
      seasonality: REAL_SEASONALITY,
      today: '2026-01-02',
    })
    expect(p.ytdActual).toBe(0)
    expect(p.projectedAnnual).toBe(0)
    expect(Number.isFinite(p.annualizedRunRate)).toBe(true)
  })
})
