import { describe, expect, it } from 'vitest'
import { sortLineItems } from './line-item-order'

describe('sortLineItems', () => {
  it('keeps saved positions ahead of later writes without positions', () => {
    const rows = [
      { id: 'new', sort_order: null, created_at: '2026-01-01' },
      { id: 'first', sort_order: 0, created_at: '2026-10-18' },
      { id: 'second', sort_order: 1, created_at: '2026-01-01' },
    ]
    expect(sortLineItems(rows).map((row) => row.id)).toEqual([
      'first',
      'second',
      'new',
    ])
    expect(rows.map((row) => row.id)).toEqual(['new', 'first', 'second'])
  })

  it('orders legacy rows by creation date and ID, with stable metadata-free rows', () => {
    expect(
      sortLineItems([
        { id: 'b', created_at: '2026-10-18' },
        { id: 'old', created_at: '2026-10-17' },
        { id: 'a', created_at: '2026-10-18' },
      ]).map((row) => row.id),
    ).toEqual(['old', 'a', 'b'])
    expect(sortLineItems([{ name: 'first' }, { name: 'second' }])).toEqual([
      { name: 'first' },
      { name: 'second' },
    ])
  })
})
