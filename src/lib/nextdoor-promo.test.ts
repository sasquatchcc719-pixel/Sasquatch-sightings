import { describe, it, expect } from 'vitest'
import {
  nextdoorDiscount,
  nextdoorServiceSubtotal,
  chooseNextdoorDiscount,
} from './nextdoor-promo'
describe('NEXTDOOR35 service-only nonstacking offer', () => {
  it('rejects $299.99 and minimum jobs; grants exactly $35 at $300', () => {
    expect(nextdoorDiscount(299.99)).toBe(0)
    expect(nextdoorDiscount(175)).toBe(0)
    expect(nextdoorDiscount(300)).toBe(35)
    expect(nextdoorDiscount(700)).toBe(35)
  })
  it('excludes travel, fees and tax from qualification', () => {
    expect(
      nextdoorServiceSubtotal([
        {
          name_snapshot: 'Cleaning',
          quantity: 1,
          unit_price: 299.99,
          category: 'Carpet Cleaning',
        },
        { name_snapshot: 'Mileage/ Travel', quantity: 1, unit_price: 25 },
        { name_snapshot: 'Tax', quantity: 1, unit_price: 10 },
        {
          name_snapshot: 'Processing',
          category: 'Fees',
          quantity: 1,
          unit_price: 5,
        },
      ]),
    ).toBe(299.99)
  })
  it('selects exactly one discount while preserving a better multi-rug saving', () => {
    expect(chooseNextdoorDiscount(35, 60)).toEqual({ promo: 0, rug: 60 })
    expect(chooseNextdoorDiscount(35, 30)).toEqual({ promo: 35, rug: 0 })
    expect(chooseNextdoorDiscount(35, 35)).toEqual({ promo: 35, rug: 0 })
  })
})
