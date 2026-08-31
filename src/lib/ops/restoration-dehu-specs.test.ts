import { describe, it, expect } from 'vitest'
import {
  DEHU_MODELS,
  ratedDepression,
  expectedDepression,
  AHAM_INTAKE_GPP,
} from './restoration-dehu-specs'

const phoenix = DEHU_MODELS['phoenix-200-ht']

describe('Phoenix 200 HT', () => {
  it('carries the figures off the manual, not a guess', () => {
    expect(phoenix.pintsPerDayAham).toBe(140)
    expect(phoenix.cfm).toBe(335)
  })

  it('produces about 28 GPP of depression at its rating', () => {
    // 140 pints/day through 335 CFM. The arithmetic is in the module.
    expect(ratedDepression(phoenix)).toBeCloseTo(28.3, 1)
  })

  it('is rated BELOW the 30 GPP the old banner demanded', () => {
    // The whole point: the software was asking Charles's machine for more than
    // it can do at its rated best, in air wetter than he ever had.
    expect(ratedDepression(phoenix)).toBeLessThan(30)
  })
})

describe('expectedDepression', () => {
  it('expects the full rating on AHAM-wet air', () => {
    expect(expectedDepression(phoenix, AHAM_INTAKE_GPP)).toBeCloseTo(28.3, 1)
  })

  it('expects less from drier air, because there is less water in it', () => {
    const onDryAir = expectedDepression(phoenix, 46)
    expect(onDryAir).toBeLessThan(ratedDepression(phoenix))
    expect(onDryAir).toBeCloseTo(14.2, 1)
  })

  it("rates Charles's own reading as the machine working properly", () => {
    // His basement: 68.8 GPP intake, 26 GPP measured depression.
    const expected = expectedDepression(phoenix, 68.8)
    expect(expected).toBeCloseTo(21.2, 1)
    expect(26).toBeGreaterThan(expected)
  })

  it('never expects more than the rating from very wet air', () => {
    expect(expectedDepression(phoenix, 150)).toBe(ratedDepression(phoenix))
  })
})
