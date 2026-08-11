import { describe, it, expect } from 'vitest'
import { lfInt, lfNum, normalizeCompetitors } from './local-falcon-sync'

describe('lfNum / lfInt', () => {
  it('turns empty and nullish strings into null, not 0', () => {
    expect(lfNum('')).toBeNull()
    expect(lfNum('null')).toBeNull()
    expect(lfNum(null)).toBeNull()
    expect(lfInt('')).toBeNull()
  })

  it('parses real numbers', () => {
    expect(lfNum('8.53')).toBeCloseTo(8.53)
    expect(lfInt('13')).toBe(13)
  })
})

describe('normalizeCompetitors', () => {
  it('keeps up to 20 rows and drops category bloat', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      rank: i + 1,
      place_id: `p${i}`,
      name: `Biz ${i}`,
      rating: '4.5',
      reviews: '10',
      address: 'Somewhere',
      phone: '555',
      url: 'https://example.com',
      categories: { a: 'huge' },
    }))
    const out = normalizeCompetitors(rows) as Array<Record<string, unknown>>
    expect(out).toHaveLength(20)
    expect(out[0].rank).toBe(1)
    expect(out[0].name).toBe('Biz 0')
    expect(out[0].categories).toBeUndefined()
  })

  it('handles missing results', () => {
    expect(normalizeCompetitors(undefined)).toEqual([])
  })
})
