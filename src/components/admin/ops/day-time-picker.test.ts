import { describe, expect, it } from 'vitest'
import { buildDayTimeline, startsOutsideTimeline } from './day-time-picker'

const appt = (
  id: string,
  start: string,
  end: string,
  label = 'Job',
) => ({ id, start_time: start, end_time: end, label })

describe('buildDayTimeline', () => {
  it('shows the gaps between jobs, not just the jobs', () => {
    // Aug 17 as it actually was: two jobs with a real gap between them.
    const items = buildDayTimeline(
      [
        appt('a', '09:00:00', '13:00:00', 'John Robinson 2'),
        appt('b', '17:30:00', '19:30:00', 'Recovery Village'),
      ],
      [{ start_time: '15:00:00', end_time: '17:00:00' }],
    )
    const gaps = items.filter((i) => i.kind === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].start).toBe(13 * 60)
    expect(gaps[0].end).toBe(17 * 60 + 30)
  })

  it('makes a gap pressable when an open window falls inside it', () => {
    const items = buildDayTimeline(
      [appt('a', '09:00:00', '13:00:00')],
      [{ start_time: '15:00:00', end_time: '17:00:00' }],
    )
    const gap = items.find((i) => i.kind === 'gap')
    expect(gap && 'bookableStarts' in gap && gap.bookableStarts).toEqual([
      '15:00',
    ])
  })

  it('keeps EVERY arrival window on a wide-open day', () => {
    // The bug this replaced: an empty day collapsed to one 9am-5pm block
    // offering only 9:00, silently dropping 11:00 and 1:00.
    const items = buildDayTimeline(
      [],
      [
        { start_time: '09:00:00', end_time: '12:00:00' },
        { start_time: '11:00:00', end_time: '14:00:00' },
        { start_time: '13:00:00', end_time: '16:00:00' },
      ],
    )
    const gap = items.find((i) => i.kind === 'gap')
    expect(gap && 'bookableStarts' in gap && gap.bookableStarts).toEqual([
      '09:00',
      '11:00',
      '13:00',
    ])
  })

  it('only offers windows that fall inside their own gap', () => {
    // 9-11 is free, 11-1 is booked, 1-5 is free. The 11:00 window belongs to
    // neither free stretch and must not appear in either.
    const items = buildDayTimeline(
      [appt('a', '11:00:00', '13:00:00')],
      [
        { start_time: '09:00:00', end_time: '11:00:00' },
        { start_time: '13:00:00', end_time: '15:00:00' },
      ],
    )
    const gaps = items.filter((i) => i.kind === 'gap')
    expect(gaps.map((g) => ('bookableStarts' in g ? g.bookableStarts : []))).toEqual(
      [['09:00'], ['13:00']],
    )
  })

  it('still shows a gap that is too short, but not pressable', () => {
    // 5:00-5:30 between a job ending at 17:00 and one starting at 17:30.
    const items = buildDayTimeline(
      [
        appt('a', '09:00:00', '17:00:00'),
        appt('b', '17:30:00', '19:30:00'),
      ],
      [],
    )
    const gaps = items.filter((i) => i.kind === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].end - gaps[0].start).toBe(30)
    expect('bookableStarts' in gaps[0] && gaps[0].bookableStarts).toEqual([])
  })

  it('keeps everything in chronological order', () => {
    const items = buildDayTimeline(
      [
        appt('a', '09:00:00', '11:00:00'),
        appt('b', '13:00:00', '15:00:00'),
      ],
      [{ start_time: '11:00:00', end_time: '13:00:00' }],
    )
    const starts = items.map((i) => i.start)
    expect(starts).toEqual([...starts].sort((x, y) => x - y))
  })

  it('handles overlapping jobs from two techs without negative gaps', () => {
    // Real Aug 17 shape: 1-5 for one tech overlaps 1-3 for the other.
    const items = buildDayTimeline(
      [
        appt('a', '09:00:00', '13:00:00'),
        appt('b', '13:00:00', '17:00:00'),
        appt('c', '13:00:00', '15:00:00'),
      ],
      [],
    )
    for (const item of items) {
      expect(item.end).toBeGreaterThan(item.start)
    }
  })

  it('covers an empty day as one open stretch', () => {
    const items = buildDayTimeline(
      [],
      [{ start_time: '09:00:00', end_time: '11:00:00' }],
    )
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('gap')
    expect(items[0].start).toBe(9 * 60)
  })

  it('stretches past 5pm to cover after-hours work', () => {
    const items = buildDayTimeline(
      [appt('a', '18:00:00', '22:00:00', 'Recovery Village')],
      [],
    )
    const booked = items.find((i) => i.kind === 'booked')
    expect(booked?.end).toBe(22 * 60)
    // The 9am-6pm stretch before it is still shown as open.
    expect(items[0].kind).toBe('gap')
    expect(items[0].start).toBe(9 * 60)
    expect(items[0].end).toBe(18 * 60)
  })

  it('falls back to a 2-hour block when an end time is missing', () => {
    const items = buildDayTimeline(
      [{ id: 'a', start_time: '09:00:00', end_time: '', label: 'Job' }],
      [],
    )
    const booked = items.find((i) => i.kind === 'booked')
    expect(booked?.end).toBe(11 * 60)
  })
})

describe('startsOutsideTimeline', () => {
  it('surfaces slots the merged day view swallows on a two-tech day', () => {
    // Real Aug 17: both techs' jobs merged cover 9-5, but the API still offers
    // 9:00, 11:00 and 3:00 because one tech is free at each. Losing those is
    // how a bookable day looks fully booked.
    const appts = [
      appt('a', '09:00:00', '13:00:00'),
      appt('b', '13:00:00', '17:00:00'),
      appt('c', '13:00:00', '15:00:00'),
      appt('d', '17:30:00', '19:30:00'),
    ]
    const slots = [
      { start_time: '09:00:00', end_time: '11:00:00' },
      { start_time: '11:00:00', end_time: '13:00:00' },
      { start_time: '15:00:00', end_time: '17:00:00' },
    ]
    const items = buildDayTimeline(appts, slots)
    expect(startsOutsideTimeline(items, slots)).toEqual([
      '09:00',
      '11:00',
      '15:00',
    ])
  })

  it('stays empty when the day view already shows every opening', () => {
    const slots = [{ start_time: '09:00:00', end_time: '12:00:00' }]
    const items = buildDayTimeline([], slots)
    expect(startsOutsideTimeline(items, slots)).toEqual([])
  })
})
