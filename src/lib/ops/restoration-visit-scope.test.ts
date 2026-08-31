import { describe, it, expect } from 'vitest'
import { readingForVisit, readingAsOf } from './restoration-visit-scope'

const readings = [
  { id: 'a', value: 30, taken_at: '2026-08-29T09:00:00-06:00', appointment_id: 'mitigation' },
  { id: 'b', value: 24, taken_at: '2026-08-30T09:00:00-06:00', appointment_id: 'monitor1' },
  { id: 'c', value: 14, taken_at: '2026-09-01T14:00:00-06:00', appointment_id: 'monitor3' },
]

describe('readingForVisit', () => {
  it('gives back only what was read on that visit', () => {
    expect(readingForVisit(readings, 'mitigation')?.value).toBe(30)
    expect(readingForVisit(readings, 'monitor1')?.value).toBe(24)
  })

  it('is empty on a visit with no reading yet, rather than borrowing another day', () => {
    // The bug: one reading looked like it belonged to every day at once.
    expect(readingForVisit(readings, 'monitor2')).toBeNull()
  })

  it('is empty when no visit is selected', () => {
    expect(readingForVisit(readings, null)).toBeNull()
  })
})

describe('readingAsOf', () => {
  it('shows what the material read on the day being viewed', () => {
    expect(readingAsOf(readings, '2026-08-29')?.value).toBe(30)
    expect(readingAsOf(readings, '2026-08-30')?.value).toBe(24)
  })

  it('carries the last known reading forward to a day nobody re-read it', () => {
    // Not re-read on the 31st: it still reads what it did on the 30th.
    expect(readingAsOf(readings, '2026-08-31')?.value).toBe(24)
  })

  it('never shows a later day when looking at an earlier one', () => {
    // Opening Saturday must not paint Tuesday's numbers onto the map.
    expect(readingAsOf(readings, '2026-08-29')?.value).not.toBe(14)
  })

  it('counts a reading taken later the same day', () => {
    const evening = [
      ...readings,
      { id: 'd', value: 22, taken_at: '2026-08-30T19:30:00-06:00', appointment_id: 'monitor1' },
    ]
    expect(readingAsOf(evening, '2026-08-30')?.value).toBe(22)
  })

  it('has nothing to show before the first reading', () => {
    expect(readingAsOf(readings, '2026-08-28')).toBeNull()
  })
})
