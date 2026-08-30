import { describe, expect, it } from 'vitest'
import {
  airMoversByWallLength,
  buildDryingPlan,
  DEHU_FACTORS,
} from './restoration-drying-plan'

/**
 * Numbers here come from the published standard, not from judgement:
 *  - ANSI/IICRC S500-2021 §12.5.3 (air movers)
 *  - IICRC Initial Dehumidification Factors and Formulas, Imperial rev 3.1.22
 */

describe('IICRC dehumidification factor chart', () => {
  it('matches the published chart exactly', () => {
    expect(DEHU_FACTORS.conventional).toEqual({ 1: 100, 2: 40, 3: 30, 4: null })
    expect(DEHU_FACTORS.lgr).toEqual({ 1: 100, 2: 50, 3: 40, 4: 40 })
    expect(DEHU_FACTORS.desiccant).toEqual({ 1: 1, 2: 2, 3: 3, 4: 3 })
  })
})

describe('dehumidification sizing', () => {
  const room = [{ affectedSqft: 500, ceilingHeightFt: 8 }] // 4,000 cu ft

  it('applies the class factor: 4,000 cu ft Class 2 LGR needs 80 PPD', () => {
    const plan = buildDryingPlan(room, { lossClass: 2, dehuType: 'lgr' })
    expect(plan.totalCubicFt).toBe(4000)
    expect(plan.dehuFactor).toBe(50)
    expect(plan.dehumidifierPintsPerDay).toBe(80)
  })

  it('needs far less on a Class 1 loss and far more on a Class 3', () => {
    expect(buildDryingPlan(room, { lossClass: 1 }).dehumidifierPintsPerDay).toBe(40)
    expect(buildDryingPlan(room, { lossClass: 3 }).dehumidifierPintsPerDay).toBe(100)
  })

  it('picks the small unit only when it can carry the whole load', () => {
    // Class 1: 40 PPD fits the 70-PPD unit.
    expect(buildDryingPlan(room, { lossClass: 1 }).suggestedDehu).toBe('DHM>')
    // Class 3: 100 PPD does not, so step up rather than stack small units.
    const classThree = buildDryingPlan(room, { lossClass: 3 })
    expect(classThree.suggestedDehu).toBe('DHM>>')
    expect(classThree.dehuCount).toBe(1)
  })

  it('adds units when one large dehumidifier cannot cover the load', () => {
    const big = buildDryingPlan([{ affectedSqft: 3000, ceilingHeightFt: 9 }], {
      lossClass: 3,
    })
    // 27,000 cu ft / 40 = 675 PPD; 675 / 110 = 7 units.
    expect(big.dehumidifierPintsPerDay).toBe(675)
    expect(big.dehuCount).toBe(7)
  })

  it('reports Class 4 conventional as unavailable rather than guessing', () => {
    const plan = buildDryingPlan(room, { lossClass: 4, dehuType: 'conventional' })
    expect(plan.dehuFactor).toBeNull()
    expect(plan.dehumidifierPintsPerDay).toBeNull()
    expect(plan.dehuCount).toBe(0)
  })

  it('sizes desiccant in CFM by air changes per hour', () => {
    // 4,000 cu ft x 2 ACH / 60 = 133.3 -> 134 CFM
    const plan = buildDryingPlan(room, { lossClass: 2, dehuType: 'desiccant' })
    expect(plan.desiccantCfm).toBe(134)
    expect(plan.dehumidifierPintsPerDay).toBeNull()
  })
})

describe('air movers, S500 12.5.3', () => {
  it('installs one per room plus one per 50-70 sf of wet floor', () => {
    // 300 sf at the normal 60 sf spacing: 1 room + 5 floor = 6.
    const plan = buildDryingPlan([{ name: 'Basement', affectedSqft: 300, ceilingHeightFt: 8 }])
    expect(plan.airMovers).toBe(6)
    expect(plan.perArea[0]).toMatchObject({ perRoom: 1, forFloor: 5, total: 6 })
  })

  it('moves within the published range with build-out density', () => {
    const area = [{ affectedSqft: 300, ceilingHeightFt: 8 }]
    expect(buildDryingPlan(area, { density: 'open' }).airMovers).toBe(1 + 5) // 300/70 -> 5
    expect(buildDryingPlan(area, { density: 'dense' }).airMovers).toBe(1 + 6) // 300/50 -> 6
  })

  it('counts wet wall and ceiling separately, at 100-150 sf', () => {
    const plan = buildDryingPlan([
      { affectedSqft: 300, ceilingHeightFt: 8, affectedWallCeilingSqft: 250 },
    ])
    // 1 room + 5 floor + ceil(250/125)=2 wall/ceiling
    expect(plan.perArea[0]).toMatchObject({ forWallCeiling: 2, total: 8 })
  })

  it('adds one for each inset or offset over 18 inches', () => {
    const plan = buildDryingPlan([
      { affectedSqft: 300, ceilingHeightFt: 8, insetsOffsets: 3 },
    ])
    expect(plan.perArea[0]).toMatchObject({ forInsets: 3, total: 9 })
  })

  it('rounds fractions up, as the standard requires', () => {
    // 61 sf at 60 per mover is 1.02 -> 2, plus the room's own = 3.
    expect(buildDryingPlan([{ affectedSqft: 61, ceilingHeightFt: 8 }]).airMovers).toBe(3)
  })

  it('serves a small room with a single air mover', () => {
    // Under 25 sf with no wet upper wall: one is adequate.
    const plan = buildDryingPlan([{ name: 'Pantry', affectedSqft: 20, ceilingHeightFt: 8 }])
    expect(plan.airMovers).toBe(1)
  })

  it('sums across rooms, each getting its own room air mover', () => {
    const plan = buildDryingPlan([
      { name: 'Basement', affectedSqft: 300, ceilingHeightFt: 8 },
      { name: 'Bathroom', affectedSqft: 32, ceilingHeightFt: 8 },
    ])
    expect(plan.airMovers).toBe(6 + 2)
    expect(plan.perArea).toHaveLength(2)
  })

  it('ignores nonsense measurements rather than producing NaN', () => {
    const plan = buildDryingPlan([
      { affectedSqft: Number.NaN, ceilingHeightFt: 8 },
      { affectedSqft: -50, ceilingHeightFt: 8 },
      { affectedSqft: 120, ceilingHeightFt: 8 },
    ])
    expect(plan.totalAffectedSqft).toBe(120)
    expect(Number.isFinite(plan.airMovers)).toBe(true)
  })
})

describe('the lower-wall alternative', () => {
  it('uses one air mover per 14 affected linear feet of wall', () => {
    expect(airMoversByWallLength(70)).toBe(5)
    expect(airMoversByWallLength(14)).toBe(1)
    expect(airMoversByWallLength(15)).toBe(2)
    expect(airMoversByWallLength(0)).toBe(0)
  })
})
