import { describe, expect, it } from 'vitest'
import {
  isExcludedFromBooking,
  PUBLIC_BOOKABLE_CATEGORIES,
} from './bookable-catalog'

describe('isExcludedFromBooking', () => {
  it('excludes internal / fee line items', () => {
    expect(isExcludedFromBooking({ slug: 'discount', name: 'Discount' })).toBe(
      true,
    )
    expect(isExcludedFromBooking({ slug: 'card-fee', name: 'Card fee' })).toBe(
      true,
    )
    expect(isExcludedFromBooking({ slug: null, name: 'Gratuity' })).toBe(true)
    expect(
      isExcludedFromBooking({ slug: null, name: 'Commercial carpet cleaning' }),
    ).toBe(true)
  })

  it('keeps real bookable services', () => {
    expect(
      isExcludedFromBooking({
        slug: 'regular-size-room',
        name: 'Regular Size Room (100 to 200 Sqft)',
      }),
    ).toBe(false)
  })

  it('keeps dryer duct available internally but excludes it from customer booking', () => {
    expect(
      isExcludedFromBooking({ slug: null, name: 'Dryer Duct cleaning' }),
    ).toBe(true)
    expect(
      isExcludedFromBooking({
        slug: 'dryer-duct-cleaning',
        name: 'Renamed internal dryer service',
      }),
    ).toBe(true)
  })

  it('never exposes water-damage Restoration in the bookable categories', () => {
    expect([...PUBLIC_BOOKABLE_CATEGORIES]).not.toContain('Restoration')
  })
})
