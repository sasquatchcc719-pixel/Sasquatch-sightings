// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsePagination, parseSince, requireDate } from './query'

describe('API v1 query parsing', () => {
  it('uses limit 50 by default and supports explicit offsets', () => {
    expect(parsePagination(new URLSearchParams())).toEqual({
      limit: 50,
      offset: 0,
    })
    expect(parsePagination(new URLSearchParams('limit=25&offset=75'))).toEqual({
      limit: 25,
      offset: 75,
    })
  })

  it('rejects invalid pagination and calendar dates', () => {
    expect(() => parsePagination(new URLSearchParams('limit=101'))).toThrow(
      'limit must be between 1 and 100',
    )
    expect(() => parsePagination(new URLSearchParams('offset=-1'))).toThrow(
      'offset must be a non-negative integer',
    )
    expect(() => requireDate('2026-02-30')).toThrow(
      'date must be a valid calendar date',
    )
  })

  it('interprets date-only call filters at midnight America/Denver', () => {
    expect(parseSince('2026-01-15')).toBe('2026-01-15T07:00:00.000Z')
    expect(parseSince('2026-07-15')).toBe('2026-07-15T06:00:00.000Z')
  })
})
