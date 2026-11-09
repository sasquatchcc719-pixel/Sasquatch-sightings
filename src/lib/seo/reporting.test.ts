import { describe, expect, it } from 'vitest'
import {
  completedWeeks,
  compareMeasurements,
  dateKey,
  evidenceState,
  formatWeeklyBrief,
  type Measurement,
} from './reporting'
const now = new Date('2026-11-09T12:00:00Z')
const current: Measurement = {
  surface: 'organic',
  metric: 'clicks',
  method: 'GSC:www:web:all-devices:v1',
  sourceRef: 'gsc:query-1',
  sourceTimezone: 'America/Los_Angeles',
  period: { start: '2026-10-26', end: '2026-11-01' },
  finalizedThrough: '2026-11-05',
  collectedAt: '2026-11-09T11:00:00Z',
  freshUntil: '2026-11-16T11:00:00Z',
  expectedSamples: 7,
  observedSamples: 7,
  failed: false,
  value: 12,
}
const previous: Measurement = {
  ...current,
  sourceRef: 'gsc:query-2',
  period: { start: '2026-10-19', end: '2026-10-25' },
  value: 10,
}
describe('calendar windows', () => {
  it('omits the unfinished week even when report runs on Monday', () => {
    expect(completedWeeks('2026-11-05')).toEqual({
      current: { start: '2026-10-26', end: '2026-11-01' },
      previous: { start: '2026-10-19', end: '2026-10-25' },
    })
  })
  it('includes Sunday only when finalized through Sunday', () => {
    expect(completedWeeks('2026-11-08').current).toEqual({
      start: '2026-11-02',
      end: '2026-11-08',
    })
  })
  it('crosses years and DST with exact seven-day dates', () => {
    expect(completedWeeks('2027-01-03').previous).toEqual({
      start: '2026-12-21',
      end: '2026-12-27',
    })
    expect(completedWeeks('2026-03-08').current).toEqual({
      start: '2026-03-02',
      end: '2026-03-08',
    })
  })
  it.each(['2026-02-30', '2026-13-01', 'yesterday', '2026-1-01'])(
    'rejects invalid date %s',
    (day) => {
      expect(() => dateKey(day)).toThrow()
    },
  )
})
describe('evidence quality', () => {
  it('keeps measured zero distinct from unavailable', () => {
    expect(evidenceState({ ...current, value: 0 }, now)).toBe('measured')
    expect(evidenceState({ ...current, value: null }, now)).toBe('unavailable')
  })
  it('labels failed, incomplete and stale evidence separately', () => {
    expect(evidenceState({ ...current, failed: true }, now)).toBe('failed')
    expect(evidenceState({ ...current, observedSamples: 6 }, now)).toBe(
      'partial',
    )
    expect(
      evidenceState({ ...current, finalizedThrough: '2026-10-30' }, now),
    ).toBe('partial')
    expect(
      evidenceState({ ...current, freshUntil: '2026-11-08T00:00:00Z' }, now),
    ).toBe('stale')
  })
  it('requires provenance and valid collection timestamps', () => {
    expect(evidenceState({ ...current, sourceRef: '' }, now)).toBe(
      'unavailable',
    )
    expect(evidenceState({ ...current, value: NaN }, now)).toBe('unavailable')
    expect(
      evidenceState({ ...current, collectedAt: '2026-11-10T00:00:00Z' }, now),
    ).toBe('unavailable')
  })
})
describe('comparable results', () => {
  it('calculates change only for comparable complete periods', () => {
    expect(compareMeasurements(current, previous, now)).toMatchObject({
      comparable: true,
      delta: 2,
      percentChange: 20,
    })
  })
  it('never mixes surfaces, methods or source timezones', () => {
    for (const altered of [
      { ...previous, surface: 'maps' as const },
      { ...previous, method: 'other' },
      { ...previous, sourceTimezone: 'UTC' },
    ]) {
      expect(compareMeasurements(current, altered, now).delta).toBeNull()
    }
  })
  it('rejects overlapping or unequal periods', () => {
    expect(
      compareMeasurements(current, { ...previous, period: current.period }, now)
        .comparable,
    ).toBe(false)
    expect(
      compareMeasurements(
        current,
        { ...previous, period: { start: '2026-10-20', end: '2026-10-25' } },
        now,
      ).comparable,
    ).toBe(false)
  })
  it('does not claim an infinite gain or a trend from missing evidence', () => {
    expect(
      compareMeasurements(current, { ...previous, value: 0 }, now)
        .percentChange,
    ).toBeNull()
    expect(
      compareMeasurements({ ...current, failed: true }, previous, now).delta,
    ).toBeNull()
  })
  it('separates the three surfaces and limits next actions to two', () => {
    const text = formatWeeklyBrief({
      period: current.period,
      results: [],
      workCompleted: [],
      uncertainty: [],
      nextActions: ['Check Monument', 'Review baseline', 'Buy another scan'],
    })
    expect(text).toContain('maps [unavailable]')
    expect(text).toContain('organic [unavailable]')
    expect(text).toContain('business [unavailable]')
    expect(text).not.toContain('Buy another scan')
    expect(text).toContain('not proof of causation')
  })
})
