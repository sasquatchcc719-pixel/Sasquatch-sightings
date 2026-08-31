/**
 * The whole chain, under the clock the server actually runs on.
 *
 * Charles: *"I just wanna make sure that the logic is correct — if I enter the
 * readings on that specific day it needs to be logged correctly in our final
 * conclusion and PDF printout."*
 *
 * Three links, each of which has its own way of losing a day:
 *   1. the timestamp written when a reading is logged,
 *   2. the column it lands in on the drying chart,
 *   3. the date printed in the PDF.
 *
 * The PDF renders on Vercel, where the process timezone is UTC — so these run
 * with TZ forced to UTC. Under Mountain time they would pass while still being
 * wrong in production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readingTimestamp } from './restoration-reading-time'
import { buildDryingChart, dayLabel } from './restoration-drying-series'

const originalTZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = 'UTC'
})
afterAll(() => {
  process.env.TZ = originalTZ
})

/** The same formatter the PDF uses for a full timestamp. */
const pdfDay = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { timeZone: 'America/Denver' })

describe("Sunday's monitor, entered on Monday, on a UTC server", () => {
  const sundayVisit = { appointment_date: '2026-08-30', start_time: '09:00:00' }
  const typedMonday = new Date('2026-08-31T18:20:00Z')

  it('stamps the reading on Sunday', () => {
    const stamp = readingTimestamp(sundayVisit, typedMonday)
    expect(pdfDay(stamp)).toBe('8/30/2026')
  })

  it("puts it in Sunday's column on the chart", () => {
    const stamp = readingTimestamp(sundayVisit, typedMonday)
    const chart = buildDryingChart([
      {
        label: 'North wall',
        material: 'Framing',
        dry_standard: 10,
        restoration_readings: [
          { value: 28, taken_at: readingTimestamp({ appointment_date: '2026-08-29', start_time: '09:00:00' }, typedMonday) },
          { value: 19, taken_at: stamp },
        ],
      },
    ])
    expect(chart.days).toEqual(['2026-08-29', '2026-08-30'])
    expect(dayLabel(chart.days[1])).toBe('Aug 30')
  })

  it('prints Sunday in the PDF', () => {
    expect(pdfDay(readingTimestamp(sundayVisit, typedMonday))).toBe('8/30/2026')
  })
})

describe('an evening reading does not roll into tomorrow', () => {
  // 7pm in Monument is already 1am UTC. Grouping or printing by the server's
  // day would move it a day forward, which is how a drying chart grows a
  // column nobody worked.
  const eveningInMonument = '2026-08-30T19:30:00-06:00'

  it('stays on the 30th in the PDF', () => {
    expect(pdfDay(eveningInMonument)).toBe('8/30/2026')
  })

  it("stays in the 30th's column on the chart", () => {
    const chart = buildDryingChart([
      {
        label: 'North wall',
        material: 'Framing',
        dry_standard: 10,
        restoration_readings: [
          { value: 28, taken_at: '2026-08-29T09:00:00-06:00' },
          { value: 19, taken_at: eveningInMonument },
        ],
      },
    ])
    expect(chart.days).toEqual(['2026-08-29', '2026-08-30'])
  })

  it('two readings on the same Monument day share one column', () => {
    const chart = buildDryingChart([
      {
        label: 'North wall',
        material: 'Framing',
        dry_standard: 10,
        restoration_readings: [
          { value: 28, taken_at: '2026-08-30T08:00:00-06:00' },
          { value: 22, taken_at: '2026-08-30T19:30:00-06:00' },
        ],
      },
    ])
    expect(chart.days).toEqual(['2026-08-30'])
    // The later one wins, as the last reading of the day.
    expect(chart.series[0].points[0].value).toBe(22)
  })
})
