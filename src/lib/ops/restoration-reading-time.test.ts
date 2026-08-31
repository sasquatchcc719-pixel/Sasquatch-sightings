import { describe, it, expect } from 'vitest'
import { readingTimestamp } from './restoration-reading-time'

/** Local time, the way an appointment date is stored and read. */
const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA')

describe('readingTimestamp', () => {
  it("dates Sunday's monitor readings to Sunday, even typed on Monday", () => {
    // The exact case: Charles entered Sunday's monitor on Monday and the report
    // said 8/31.
    const typedOnMonday = new Date('2026-08-31T12:20:00-06:00')
    const stamp = readingTimestamp(
      { appointment_date: '2026-08-30', start_time: '09:00:00' },
      typedOnMonday,
    )
    expect(localDay(stamp)).toBe('2026-08-30')
  })

  it('uses the visit start time, so a day sorts before the next one', () => {
    const stamp = readingTimestamp(
      { appointment_date: '2026-08-30', start_time: '14:00:00' },
      new Date('2026-08-31T12:00:00-06:00'),
    )
    expect(new Date(stamp).getHours()).toBe(14)
  })

  it('never stamps a reading ahead of today', () => {
    // A visit scheduled for tomorrow cannot have produced a reading; a chart
    // running into next week reads as a bug.
    const now = new Date('2026-08-31T12:00:00-06:00')
    const stamp = readingTimestamp(
      { appointment_date: '2026-09-05', start_time: '09:00:00' },
      now,
    )
    expect(stamp).toBe(now.toISOString())
  })

  it('falls back to now when there is no visit', () => {
    const now = new Date('2026-08-31T12:00:00-06:00')
    expect(readingTimestamp(null, now)).toBe(now.toISOString())
    expect(readingTimestamp({ appointment_date: null, start_time: null }, now)).toBe(
      now.toISOString(),
    )
  })

  it('survives a malformed date rather than producing an invalid one', () => {
    const now = new Date('2026-08-31T12:00:00-06:00')
    expect(readingTimestamp({ appointment_date: 'not-a-date', start_time: null }, now)).toBe(
      now.toISOString(),
    )
  })
})
