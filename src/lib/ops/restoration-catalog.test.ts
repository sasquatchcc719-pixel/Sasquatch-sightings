import { describe, expect, it } from 'vitest'
import {
  categoryAt,
  isBillable,
  listConcepts,
  resolveVariant,
  type RestorationCatalogItem,
} from './restoration-catalog'

// Real rows from the Colorado WTR price list (2024-01-29).
function item(
  code: string,
  price: number,
  opts: Partial<RestorationCatalogItem> = {},
): RestorationCatalogItem {
  return {
    id: code,
    code,
    description: code,
    unit: 'SF',
    unit_price: price,
    water_category: null,
    after_hours: false,
    is_heavy: false,
    concept_code: 'EXT',
    concept_label: 'Water extraction from carpeted floor',
    is_enabled: true,
    quickbooks_item_id: 'qb-1',
    ...opts,
  }
}

const EXTRACTION: RestorationCatalogItem[] = [
  item('EXT', 0.58),
  item('EXT+', 0.71, { is_heavy: true }),
  item('EXTA', 0.86, { after_hours: true }),
  item('EXTA+', 1.04, { after_hours: true, is_heavy: true }),
  item('EXTG', 0.9, { water_category: 2 }),
  item('EXTG+', 1.08, { water_category: 2, is_heavy: true }),
  item('EXTGA', 1.38, { water_category: 2, after_hours: true }),
  item('EXTS', 1.47, { water_category: 3 }),
  item('EXTS+', 1.73, { water_category: 3, is_heavy: true }),
  item('EXTSA', 2.12, { water_category: 3, after_hours: true }),
]

describe('resolveVariant', () => {
  it('picks the clean-water rate for a Cat 1 daytime loss', () => {
    const hit = resolveVariant(EXTRACTION, 'EXT', {
      waterCategory: 1,
      afterHours: false,
    })
    expect(hit?.code).toBe('EXT')
    expect(hit?.unit_price).toBe(0.58)
  })

  it('picks the Cat 3 rate for the Jill loss rather than the Cat 1 rate', () => {
    // Exterior water, dirty, sat four days: Category 3.
    const hit = resolveVariant(EXTRACTION, 'EXT', {
      waterCategory: 3,
      afterHours: false,
    })
    expect(hit?.code).toBe('EXTS')
    expect(hit?.unit_price).toBe(1.47)
  })

  it('combines category, after hours, and heavy', () => {
    expect(
      resolveVariant(EXTRACTION, 'EXT', {
        waterCategory: 3,
        afterHours: false,
        heavy: true,
      })?.code,
    ).toBe('EXTS+')
    expect(
      resolveVariant(EXTRACTION, 'EXT', {
        waterCategory: 2,
        afterHours: true,
      })?.code,
    ).toBe('EXTGA')
  })

  it('degrades downward when the exact variant does not exist', () => {
    // No Cat 3 + after hours + heavy row exists; fall back, never fail.
    const hit = resolveVariant(EXTRACTION, 'EXT', {
      waterCategory: 3,
      afterHours: true,
      heavy: true,
    })
    // Category is relaxed last, so this must stay on the Cat 3 rate ($2.12)
    // rather than dropping to the Cat 1 heavy rate ($1.04).
    expect(hit?.code).toBe('EXTSA')
    expect(hit?.unit_price).toBe(2.12)
  })

  it('falls back to a lower category rather than dead-ending', () => {
    const catOneOnly = [item('FCC', 0.76, { concept_code: 'FCC' })]
    const hit = resolveVariant(catOneOnly, 'FCC', {
      waterCategory: 3,
      afterHours: false,
    })
    expect(hit?.code).toBe('FCC')
  })

  it('ignores disabled items and unknown concepts', () => {
    const disabled = EXTRACTION.map((i) => ({ ...i, is_enabled: false }))
    expect(resolveVariant(disabled, 'EXT', { waterCategory: 1, afterHours: false })).toBeNull()
    expect(resolveVariant(EXTRACTION, 'NOPE', { waterCategory: 1, afterHours: false })).toBeNull()
  })
})

describe('listConcepts', () => {
  it('collapses every price variant into one choice', () => {
    const concepts = listConcepts(EXTRACTION)
    expect(concepts).toHaveLength(1)
    expect(concepts[0].label).toBe('Water extraction from carpeted floor')
  })
})

describe('isBillable', () => {
  it('requires a QuickBooks mapping before an item can reach an invoice', () => {
    expect(isBillable(item('EXT', 0.58))).toBe(true)
    expect(isBillable(item('EXT', 0.58, { quickbooks_item_id: null }))).toBe(false)
    expect(isBillable(item('EXT', 0.58, { is_enabled: false }))).toBe(false)
  })
})

describe('categoryAt', () => {
  it('applies the category in effect when the work was performed', () => {
    const events = [
      { water_category: 1, effective_at: '2026-08-26T08:00:00Z' },
      { water_category: 3, effective_at: '2026-08-30T09:00:00Z' },
    ]
    expect(categoryAt(events, new Date('2026-08-27T12:00:00Z'))).toBe(1)
    expect(categoryAt(events, new Date('2026-08-30T18:00:00Z'))).toBe(3)
  })

  it('falls back when no event precedes the moment', () => {
    expect(categoryAt([], new Date('2026-08-30T18:00:00Z'), 2)).toBe(2)
  })
})
