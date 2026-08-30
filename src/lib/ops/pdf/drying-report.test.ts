import { describe, expect, it } from 'vitest'

/**
 * Mirrors the date formatter in drying-report.tsx. A date-only value must render
 * as that calendar day, not the day before, or the report states the wrong date
 * of loss on a document handed to an adjuster.
 */
function day(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US')
  }
  return new Date(value).toLocaleDateString('en-US')
}

describe('drying report dates', () => {
  it('renders a date-only loss date as that calendar day', () => {
    expect(day('2026-08-26')).toBe('8/26/2026')
    expect(day('2026-01-01')).toBe('1/1/2026')
    expect(day('2026-12-31')).toBe('12/31/2026')
  })

  it('still converts real timestamps', () => {
    expect(day('2026-08-30T18:00:00Z')).toBe('8/30/2026')
  })
})
