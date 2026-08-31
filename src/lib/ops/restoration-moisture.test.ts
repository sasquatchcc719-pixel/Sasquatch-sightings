import { describe, it, expect } from 'vitest'
import {
  moistureBand,
  defaultDryStandard,
  DEFAULT_DRY_STANDARD,
} from './restoration-moisture'

describe('moistureBand', () => {
  it('reproduces the numbers Charles gave for framing at a 10% baseline', () => {
    // "anything below like 12 would be green"
    expect(moistureBand(9, 10)).toBe('dry')
    expect(moistureBand(11.9, 10)).toBe('dry')
    // "between 12 and 25 would be yellow"
    expect(moistureBand(12.5, 10)).toBe('drying')
    expect(moistureBand(24, 10)).toBe('drying')
    // "above 25 would be red"
    expect(moistureBand(26, 10)).toBe('wet')
  })

  it('moves the whole scale when the material dries out at a different number', () => {
    // A material whose unaffected reading is 6 is wet far sooner than one at 10.
    expect(moistureBand(9, 6)).toBe('drying')
    expect(moistureBand(9, 14)).toBe('dry')
  })

  it('says it does not know rather than guessing green', () => {
    expect(moistureBand(12, null)).toBe('unknown')
    expect(moistureBand(null, 10)).toBe('unknown')
    expect(moistureBand(Number.NaN, 10)).toBe('unknown')
  })

  it('counts a reading below the standard as dry, not as an error', () => {
    expect(moistureBand(4, 10)).toBe('dry')
  })
})

describe('defaultDryStandard', () => {
  it('starts the wood family at the baseline Charles gave', () => {
    expect(defaultDryStandard('Framing')).toBe(10)
    expect(defaultDryStandard('Subfloor')).toBe(10)
    expect(defaultDryStandard('Hardwood')).toBe(10)
  })

  it('invents nothing for materials that do not read like wood', () => {
    // Charles's 10 was applied to all of these and set a green target he had
    // never hit. Gypsum and concrete are read on relative or reference scales
    // that differ by meter, so a number here is not cautious — it is meaningless.
    for (const material of ['Drywall', 'Plaster', 'Insulation', 'Concrete', 'Tile']) {
      expect(defaultDryStandard(material)).toBeNull()
      expect(DEFAULT_DRY_STANDARD[material]).toBeUndefined()
    }
  })

  it('has no opinion when the material is unset', () => {
    expect(defaultDryStandard(null)).toBeNull()
    expect(defaultDryStandard('Something new')).toBeNull()
  })
})
