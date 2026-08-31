import { describe, it, expect } from 'vitest'
import { readingForVisit, visitIsFuture } from './restoration-visit-scope'

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

describe('visitIsFuture', () => {
  it('knows a visit that has not happened yet', () => {
    expect(visitIsFuture({ appointment_date: '2026-09-01', status: 'booked' }, '2026-08-31')).toBe(true)
  })

  it('does not call today or the past future', () => {
    expect(visitIsFuture({ appointment_date: '2026-08-31', status: 'booked' }, '2026-08-31')).toBe(false)
    expect(visitIsFuture({ appointment_date: '2026-08-29', status: 'booked' }, '2026-08-31')).toBe(false)
  })

  it('trusts a completed visit over its date', () => {
    // Closed out early, or the date was corrected afterwards.
    expect(visitIsFuture({ appointment_date: '2026-09-05', status: 'completed' }, '2026-08-31')).toBe(false)
  })
})
