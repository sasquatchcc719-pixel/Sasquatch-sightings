import { describe, expect, it } from 'vitest'
import {
  buildCatalogMenu,
  quoteFromSelections,
  type CatalogItem,
} from './quote'

function catalog(): CatalogItem[] {
  return [
    {
      id: 'id-regular',
      name: 'Regular Size Room (100 to 200 Sqft)',
      slug: null,
      basePrice: 46,
      pricingUnit: 'fixed',
    },
    {
      id: 'id-step',
      name: 'Step Carpet Cleaning (Per Step Charge)',
      slug: null,
      basePrice: 4,
      pricingUnit: 'per_step',
    },
    {
      id: 'id-duct',
      name: 'Dryer Duct cleaning',
      slug: null,
      basePrice: 80,
      pricingUnit: 'fixed',
    },
  ]
}

describe('buildCatalogMenu', () => {
  it('numbers the real catalog so the model picks by number', () => {
    const menu = buildCatalogMenu(catalog())
    expect(menu).toContain('1. Regular Size Room (100 to 200 Sqft) — $46')
    expect(menu).toContain('3. Dryer Duct cleaning — $80')
  })
})

describe('quoteFromSelections', () => {
  it('resolves numbered picks to real ids + the real total (no collapse)', () => {
    const quote = quoteFromSelections(catalog(), [
      { item: 1, quantity: 3 },
      { item: 2, quantity: 15 },
      { item: 3, quantity: 1 },
    ])
    expect(
      quote.lines.map((l) => [l.serviceCatalogItemId, l.quantity, l.lineTotal]),
    ).toEqual([
      ['id-regular', 3, 138],
      ['id-step', 15, 60],
      ['id-duct', 1, 80],
    ])
    expect(quote.total).toBe(278)
    expect(quote.invalidItems).toEqual([])
    expect(new Set(quote.lines.map((l) => l.serviceCatalogItemId)).size).toBe(3)
  })

  it('flags an out-of-range pick instead of inventing a service', () => {
    const quote = quoteFromSelections(catalog(), [
      { item: 1, quantity: 1 },
      { item: 99, quantity: 1 },
    ])
    expect(quote.lines).toHaveLength(1)
    expect(quote.invalidItems).toEqual([99])
  })
})
