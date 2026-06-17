/**
 * Tests for deterministic catalog matching — the root-cause fix for the booking
 * "issue matching the services" collapse (see docs/HARRY-REBUILD-PLAN.md).
 * The decisive one is "no collapse": distinct descriptors map to distinct items.
 */
import { describe, expect, it } from 'vitest'
import { matchServiceDescription, type CatalogItem } from './match-service'

function catalog(): CatalogItem[] {
  return [
    item(
      'id-closet',
      'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
      25,
    ),
    item('id-regular', 'Regular Size Room (100 to 200 Sqft)', 46),
    item('id-sasquatch', 'Sasquatch Size Room (200 to 400 Sqft)', 90),
    item('id-step', 'Step Carpet Cleaning (Per Step Charge)', 4, 'per_step'),
    item('id-urine', 'Urine Eliminator Treatment', 25),
    item('id-deodorizer', 'Deodorizer', 12),
    item('id-vacuum', 'Pre-Vacuum', 10),
    item('id-duct', 'Dryer Duct cleaning', 80),
  ]
}

function item(
  id: string,
  name: string,
  basePrice: number,
  pricingUnit = 'fixed',
): CatalogItem {
  return { id, name, slug: null, basePrice, pricingUnit }
}

function matchedId(descriptor: string, qty = 1): string {
  const m = matchServiceDescription(catalog(), descriptor, qty)
  if (m.status !== 'matched')
    throw new Error(`expected match for "${descriptor}", got ${m.status}`)
  return m.item.id
}

describe('matchServiceDescription — quoting rules', () => {
  it('defaults a plain bedroom to Regular, NOT Sasquatch (the documented rule)', () => {
    expect(matchedId('bedroom')).toBe('id-regular')
    expect(matchedId('master bedroom')).toBe('id-regular')
    expect(matchedId('a couple bedrooms')).toBe('id-regular')
  })

  it('upgrades to Sasquatch only on an explicit large signal', () => {
    expect(matchedId('big open living room')).toBe('id-sasquatch')
    expect(matchedId('huge basement')).toBe('id-sasquatch')
  })

  it('maps add-ons and specials by keyword', () => {
    expect(matchedId('the stairs')).toBe('id-step')
    expect(matchedId('dryer duct')).toBe('id-duct')
    expect(matchedId('the closet')).toBe('id-closet')
    expect(matchedId('pet urine in the carpet')).toBe('id-urine')
  })

  it('carries the quantity through', () => {
    const m = matchServiceDescription(catalog(), 'bedrooms', 3)
    if (m.status !== 'matched') throw new Error('expected match')
    expect(m.quantity).toBe(3)
  })
})

describe('matchServiceDescription — NO COLLAPSE (the booking failure)', () => {
  it('maps distinct descriptors to distinct catalog items', () => {
    // Old Harry collapsed three services onto one id (and left one empty).
    const ids = ['2 bedrooms', 'the stairs', 'dryer duct'].map((d) =>
      matchedId(d),
    )
    expect(ids).toEqual(['id-regular', 'id-step', 'id-duct'])
    expect(new Set(ids).size).toBe(3) // all different — no collapse
  })

  it('never returns an empty/blank id', () => {
    const m = matchServiceDescription(catalog(), 'bedroom')
    if (m.status !== 'matched') throw new Error('expected match')
    expect(m.item.id).toBeTruthy()
  })
})

describe('matchServiceDescription — refuses to guess', () => {
  it('returns none for something not in the catalog', () => {
    expect(matchServiceDescription(catalog(), 'gutter cleaning').status).toBe(
      'none',
    )
  })

  it('returns none for an empty descriptor', () => {
    expect(matchServiceDescription(catalog(), '   ').status).toBe('none')
  })
})

describe('matchServiceDescription — square footage + size names (the loop bug)', () => {
  it('maps square footage to the right tier', () => {
    expect(matchedId('living room 350 ft²')).toBe('id-sasquatch')
    expect(matchedId('the living room, about 150 sqft')).toBe('id-regular')
  })

  it('matches a size-tier name even when phrased as "area"', () => {
    expect(matchedId('Sasquatch size area')).toBe('id-sasquatch')
  })
})
