import { describe, it, expect } from 'vitest'
import { selectOpportunities } from './gsc-opportunities'
import type { GscKeywordRow } from './gsc'

function row(p: Partial<GscKeywordRow>): GscKeywordRow {
  return {
    keyword: 'kw',
    page: 'https://www.sasquatchcarpet.com/',
    clicks: 0,
    impressions: 10,
    ctr: 0,
    position: 14,
    ...p,
  }
}

describe('selectOpportunities', () => {
  it('keeps only positions in the 8-20.5 band', () => {
    const rows = [
      row({ keyword: 'too-high', position: 3, page: '/a' }),
      row({ keyword: 'page2', position: 14, page: '/b' }),
      row({ keyword: 'too-low', position: 35, page: '/c' }),
    ]
    const out = selectOpportunities(rows)
    expect(out.map((r) => r.keyword)).toEqual(['page2'])
  })

  it('drops low-impression noise (wrong-geo one-offs)', () => {
    const rows = [
      row({ keyword: 'volcano', position: 20, impressions: 1, page: '/x' }),
      row({ keyword: 'real', position: 12, impressions: 37, page: '/y' }),
    ]
    const out = selectOpportunities(rows)
    expect(out.map((r) => r.keyword)).toEqual(['real'])
  })

  it('keeps only the highest-impression keyword per page', () => {
    const rows = [
      row({
        keyword: 'briargate-upholstery',
        position: 14,
        impressions: 37,
        page: '/briargate',
      }),
      row({
        keyword: 'briargate-tile',
        position: 20,
        impressions: 37,
        page: '/briargate',
      }),
      row({
        keyword: 'cs-cheap',
        position: 16,
        impressions: 10,
        page: '/colorado-springs',
      }),
    ]
    const out = selectOpportunities(rows)
    // one entry per page, briargate first (higher/equal impressions, inserted first)
    expect(out).toHaveLength(2)
    expect(out[0].page).toBe('/briargate')
    expect(out[1].page).toBe('/colorado-springs')
  })

  it('sorts by impressions descending', () => {
    const rows = [
      row({ keyword: 'small', position: 12, impressions: 8, page: '/a' }),
      row({ keyword: 'big', position: 18, impressions: 37, page: '/b' }),
      row({ keyword: 'mid', position: 10, impressions: 22, page: '/c' }),
    ]
    const out = selectOpportunities(rows)
    expect(out.map((r) => r.keyword)).toEqual(['big', 'mid', 'small'])
  })

  it('caps at 6 opportunities', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        keyword: `k${i}`,
        position: 12,
        impressions: 100 - i,
        page: `/p${i}`,
      }),
    )
    expect(selectOpportunities(rows)).toHaveLength(6)
  })
})
