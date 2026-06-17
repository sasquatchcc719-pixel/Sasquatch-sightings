import { describe, expect, it } from 'vitest'
import { buildQuote } from './quote'
import type { CatalogItem } from './match-service'

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

describe('buildQuote', () => {
  it('turns plain-words services into real line items + the real total', () => {
    const quote = buildQuote(catalog(), [
      { description: '3 bedrooms', quantity: 3 },
      { description: 'the stairs', quantity: 15 },
      { description: 'dryer duct', quantity: 1 },
    ])

    expect(
      quote.lines.map((l) => [l.serviceCatalogItemId, l.quantity, l.lineTotal]),
    ).toEqual([
      ['id-regular', 3, 138],
      ['id-step', 15, 60],
      ['id-duct', 1, 80],
    ])
    expect(quote.total).toBe(278) // 138 + 60 + 80 — computed by code, not the model
    // No collapse: three distinct services -> three distinct ids.
    expect(new Set(quote.lines.map((l) => l.serviceCatalogItemId)).size).toBe(3)
  })

  it('surfaces unmatched descriptors instead of guessing or dropping silently', () => {
    const quote = buildQuote(catalog(), [
      { description: 'bedroom', quantity: 1 },
      { description: 'gutter cleaning', quantity: 1 },
    ])
    expect(quote.lines).toHaveLength(1)
    expect(quote.unmatched).toEqual(['gutter cleaning'])
  })
})
