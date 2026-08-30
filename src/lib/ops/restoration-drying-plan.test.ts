import { describe, expect, it } from 'vitest'
import { buildDryingPlan } from './restoration-drying-plan'

describe('buildDryingPlan', () => {
  it('adds up affected area and volume across rooms', () => {
    const plan = buildDryingPlan([
      { affectedSqft: 400, ceilingHeightFt: 8 },
      { affectedSqft: 150, ceilingHeightFt: 9 },
    ])
    expect(plan.totalAffectedSqft).toBe(550)
    expect(plan.totalCubicFt).toBe(400 * 8 + 150 * 9)
  })

  it('suggests air movers from affected floor area', () => {
    expect(buildDryingPlan([{ affectedSqft: 400, ceilingHeightFt: 8 }]).airMovers).toBe(7)
    // Any affected area at all needs at least one.
    expect(buildDryingPlan([{ affectedSqft: 10, ceilingHeightFt: 8 }]).airMovers).toBe(1)
  })

  it('steps up to the large dehumidifier rather than stacking small ones', () => {
    const small = buildDryingPlan([{ affectedSqft: 300, ceilingHeightFt: 8 }])
    expect(small.suggestedDehu).toBe('DHM>')
    expect(small.dehuCount).toBe(1)

    const large = buildDryingPlan([{ affectedSqft: 1200, ceilingHeightFt: 9 }])
    expect(large.suggestedDehu).toBe('DHM>>')
    expect(large.dehuCount).toBeGreaterThanOrEqual(2)
  })

  it('defaults a missing ceiling height to eight feet', () => {
    expect(buildDryingPlan([{ affectedSqft: 100, ceilingHeightFt: null }]).totalCubicFt).toBe(800)
  })

  it('suggests nothing when nothing is affected', () => {
    const plan = buildDryingPlan([{ affectedSqft: 0, ceilingHeightFt: 8 }, { affectedSqft: null, ceilingHeightFt: 8 }])
    expect(plan).toMatchObject({
      totalAffectedSqft: 0,
      airMovers: 0,
      dehuCount: 0,
      suggestedDehu: null,
    })
  })

  it('ignores nonsense measurements instead of producing NaN', () => {
    const plan = buildDryingPlan([
      { affectedSqft: Number.NaN, ceilingHeightFt: 8 },
      { affectedSqft: -50, ceilingHeightFt: 8 },
      { affectedSqft: 120, ceilingHeightFt: 8 },
    ])
    expect(plan.totalAffectedSqft).toBe(120)
    expect(Number.isFinite(plan.totalCubicFt)).toBe(true)
  })
})
