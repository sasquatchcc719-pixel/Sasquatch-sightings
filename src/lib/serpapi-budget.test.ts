import { describe, expect, it } from 'vitest'
import { getSerpApiPeriodStart } from './serpapi-budget'

describe('getSerpApiPeriodStart', () => {
  it('uses the previous cycle before the renewal day', () => {
    expect(
      getSerpApiPeriodStart(
        new Date('2026-07-05T18:00:00.000Z'),
        6,
        'America/Denver',
      ),
    ).toBe('2026-06-06')
  })

  it('starts a new cycle on the renewal day', () => {
    expect(
      getSerpApiPeriodStart(
        new Date('2026-07-06T18:00:00.000Z'),
        6,
        'America/Denver',
      ),
    ).toBe('2026-07-06')
  })

  it('handles year rollover', () => {
    expect(
      getSerpApiPeriodStart(
        new Date('2026-01-05T18:00:00.000Z'),
        6,
        'America/Denver',
      ),
    ).toBe('2025-12-06')
  })
})
