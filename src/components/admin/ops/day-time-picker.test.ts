import { describe, expect, it } from 'vitest'
import { buildDayTimeline } from './day-time-picker'

const appt = (id: string, start: string, end: string, label = 'Job') => ({
  id,
  start_time: start,
  end_time: end,
  label,
})

const slot = (start: string, end: string) => ({
  start_time: start,
  end_time: end,
})

/** Compact "09:00-11:00 booked|open" view of a timeline, for readable asserts. */
const shape = (items: ReturnType<typeof buildDayTimeline>) =>
  items.map((i) => {
    const t = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    return `${t(i.start)}-${t(i.end)} ${i.kind}`
  })

describe('buildDayTimeline', () => {
  it('lists each opening as its own row, in line with the jobs', () => {
    // Aug 18 as it actually looks: one 2-hour job, then three open windows.
    const items = buildDayTimeline(
      [appt('a', '09:00:00', '11:00:00', 'Anne Porter')],
      [
        slot('11:00:00', '13:00:00'),
        slot('13:00:00', '15:00:00'),
        slot('15:00:00', '17:00:00'),
      ],
    )
    expect(shape(items)).toEqual([
      '09:00-11:00 booked',
      '11:00-13:00 open',
      '13:00-15:00 open',
      '15:00-17:00 open',
    ])
  })

  it('carries the exact time to book on each open row', () => {
    const items = buildDayTimeline([], [slot('13:00:00', '15:00:00')])
    const open = items[0]
    expect(open.kind).toBe('open')
    expect(open.kind === 'open' && open.startTime).toBe('13:00')
  })

  it('keeps every opening — never collapses them into one block', () => {
    // The bug this replaced: a wide-open day showed a single 9am-5pm row.
    const items = buildDayTimeline(
      [],
      [
        slot('09:00:00', '12:00:00'),
        slot('11:00:00', '14:00:00'),
        slot('13:00:00', '16:00:00'),
      ],
    )
    expect(items.filter((i) => i.kind === 'open')).toHaveLength(3)
  })

  it('keeps openings that overlap another tech job on a two-tech day', () => {
    // Real Aug 17: jobs cover 9-5 across two techs, but 9:00, 11:00 and 3:00
    // are each free for one of them. Subtracting jobs would erase all three.
    const items = buildDayTimeline(
      [
        appt('a', '09:00:00', '13:00:00'),
        appt('b', '13:00:00', '17:00:00'),
        appt('c', '13:00:00', '15:00:00'),
      ],
      [
        slot('09:00:00', '11:00:00'),
        slot('11:00:00', '13:00:00'),
        slot('15:00:00', '17:00:00'),
      ],
    )
    expect(items.filter((i) => i.kind === 'open')).toHaveLength(3)
  })

  it('sorts everything by the clock', () => {
    const items = buildDayTimeline(
      [appt('a', '13:00:00', '15:00:00')],
      [slot('09:00:00', '11:00:00'), slot('15:00:00', '17:00:00')],
    )
    expect(shape(items)).toEqual([
      '09:00-11:00 open',
      '13:00-15:00 booked',
      '15:00-17:00 open',
    ])
  })

  it('puts the job first when a job and an opening start together', () => {
    const items = buildDayTimeline(
      [appt('a', '09:00:00', '13:00:00')],
      [slot('09:00:00', '11:00:00')],
    )
    expect(items[0].kind).toBe('booked')
  })

  it('shows after-hours work at its real time', () => {
    const items = buildDayTimeline(
      [appt('a', '18:00:00', '22:00:00', 'Recovery Village')],
      [],
    )
    expect(shape(items)).toEqual(['18:00-22:00 booked'])
  })

  it('falls back to a 2-hour block when an end time is missing', () => {
    const items = buildDayTimeline(
      [{ id: 'a', start_time: '09:00:00', end_time: '', label: 'Job' }],
      [],
    )
    expect(items[0].end).toBe(11 * 60)
  })

  it('is empty when there is nothing booked and nothing offered', () => {
    expect(buildDayTimeline([], [])).toEqual([])
  })
})
