import { describe, it, expect } from 'vitest'
import {
  computeAfterHoursMinutes,
  computePremiumPay,
  isRecoveryVillage,
} from './after-hours-premium'

describe('isRecoveryVillage', () => {
  it('matches despite trailing space / case', () => {
    expect(isRecoveryVillage('Recovery Village ')).toBe(true)
    expect(isRecoveryVillage('recovery village')).toBe(true)
    expect(isRecoveryVillage('Recovery Village')).toBe(true)
  })
  it('rejects other customers', () => {
    expect(isRecoveryVillage('Levis Custom Clean')).toBe(false)
    expect(isRecoveryVillage(null)).toBe(false)
    expect(isRecoveryVillage(undefined)).toBe(false)
  })
})

describe('computeAfterHoursMinutes (America/Denver, June = MDT/UTC-6)', () => {
  it('counts the whole window when it starts after 5pm (6:00–8:10pm = 130m)', () => {
    // 6:00pm MDT Jun 18 = 00:00Z Jun 19; 8:10pm = 02:10Z Jun 19
    expect(
      computeAfterHoursMinutes('2026-06-19T00:00:00Z', '2026-06-19T02:10:00Z'),
    ).toBe(130)
  })
  it('counts only the post-5pm portion when straddling (4:30–7:30pm = 150m)', () => {
    // 4:30pm MDT = 22:30Z Jun 18; 7:30pm = 01:30Z Jun 19; 5pm cutoff = 23:00Z
    expect(
      computeAfterHoursMinutes('2026-06-18T22:30:00Z', '2026-06-19T01:30:00Z'),
    ).toBe(150)
  })
  it('returns 0 for a job entirely before 5pm (1–3pm)', () => {
    expect(
      computeAfterHoursMinutes('2026-06-18T19:00:00Z', '2026-06-18T21:00:00Z'),
    ).toBe(0)
  })
  it('returns 0 for missing or inverted timestamps', () => {
    expect(computeAfterHoursMinutes(null, '2026-06-19T02:10:00Z')).toBe(0)
    expect(computeAfterHoursMinutes('2026-06-19T02:10:00Z', null)).toBe(0)
    expect(
      computeAfterHoursMinutes('2026-06-19T02:10:00Z', '2026-06-19T00:00:00Z'),
    ).toBe(0)
  })
})

describe('computePremiumPay', () => {
  it('computes $10/hr rounded to cents', () => {
    expect(computePremiumPay(130)).toBe(21.67)
    expect(computePremiumPay(150)).toBe(25)
    expect(computePremiumPay(0)).toBe(0)
  })
})
