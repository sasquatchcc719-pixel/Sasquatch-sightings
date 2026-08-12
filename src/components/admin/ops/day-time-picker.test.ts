import { describe, expect, it } from 'vitest'
import { buildDayTimeline } from './day-time-picker'

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
    expect(gap && 'bookableAt' in gap && gap.bookableAt).toBe('15:00')
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
    expect('bookableAt' in gaps[0] && gaps[0].bookableAt).toBeNull()
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
