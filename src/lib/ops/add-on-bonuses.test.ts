import { describe, expect, it } from 'vitest'
import {
  discountedEligibleRevenue,
  isNewQualifyingServiceCategory,
  qualifyingAddOnCategory,
} from './add-on-bonuses'

describe('qualifyingAddOnCategory', () => {
  it('recognizes the four bonus service categories', () => {
    expect(
      qualifyingAddOnCategory('Carpet Cleaning', 'Regular Size Room'),
    ).toBe('carpet_cleaning')
    expect(
      qualifyingAddOnCategory('Hard Surface', 'Tile & grout cleaning'),
    ).toBe('tile_and_grout')
    expect(qualifyingAddOnCategory('rug cleaning', 'Area Rug 5x8')).toBe(
      'rug_cleaning',
    )
    expect(qualifyingAddOnCategory('Upholstery Cleaning', 'Sofa / Couch')).toBe(
      'upholstery_cleaning',
    )
  })

  it('does not turn fees or ancillary carpet treatments into bonuses', () => {
    expect(qualifyingAddOnCategory('Carpet Cleaning', 'Card fee')).toBeNull()
    expect(
      qualifyingAddOnCategory('Carpet Cleaning', 'Urine Eliminator Treatment'),
    ).toBeNull()
    expect(
      qualifyingAddOnCategory('Hard Surface', 'Auto scrubbing Floors'),
    ).toBeNull()
  })

  it('rejects more work in the original category but accepts a new category', () => {
    const baseline = ['carpet_cleaning'] as const
    expect(isNewQualifyingServiceCategory('carpet_cleaning', baseline)).toBe(
      false,
    )
    expect(
      isNewQualifyingServiceCategory('upholstery_cleaning', baseline),
    ).toBe(true)
  })
})

describe('discountedEligibleRevenue', () => {
  it('prorates invoice discounts before calculating the bonus base', () => {
    expect(discountedEligibleRevenue(150, 500, 50, 0)).toBe(135)
    expect(discountedEligibleRevenue(150, 500, 0, 50)).toBe(135)
  })
})
