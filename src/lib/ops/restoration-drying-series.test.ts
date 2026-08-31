import { describe, it, expect } from 'vitest'
import { buildDryingChart, dayLabel } from './restoration-drying-series'

const point = (
  label: string,
  dry: number | null,
  readings: Array<[string, number]>,
) => ({
  label,
  material: 'Framing',
  dry_standard: dry,
  restoration_readings: readings.map(([taken_at, value]) => ({ value, taken_at })),
})

describe('buildDryingChart', () => {
  it('lines readings up by day across every point', () => {
    const chart = buildDryingChart([
      point('North wall', 10, [
        ['2026-08-29T09:00:00-06:00', 28],
        ['2026-08-30T09:00:00-06:00', 20],
        ['2026-08-31T09:00:00-06:00', 11],
      ]),
      point('Closet', 10, [
        ['2026-08-29T09:30:00-06:00', 32],
        ['2026-08-31T09:30:00-06:00', 14],
      ]),
    ])

    expect(chart.days).toHaveLength(3)
    expect(chart.series).toHaveLength(2)
    // The closet skipped a day; its second reading still lands on day three.
    expect(chart.series[1].points.map((p) => p.dayIndex)).toEqual([0, 2])
  })

  it('keeps the last reading when a point is read twice in a day', () => {
    // A re-read means the first was wrong, or a fan had just been moved.
    const chart = buildDryingChart([
      point('North wall', 10, [
        ['2026-08-29T09:00:00-06:00', 28],
        ['2026-08-29T16:00:00-06:00', 26],
        ['2026-08-30T09:00:00-06:00', 19],
      ]),
    ])
    expect(chart.series[0].points).toHaveLength(2)
    expect(chart.series[0].points[0].value).toBe(26)
  })

  it('leaves room below for the dry standard line', () => {
    const chart = buildDryingChart([point('North wall', 8, [
      ['2026-08-29T09:00:00-06:00', 30],
      ['2026-08-30T09:00:00-06:00', 20],
    ])])
    expect(chart.minValue).toBeLessThanOrEqual(8)
    expect(chart.maxValue).toBeGreaterThanOrEqual(30)
  })

  it('will not plot a single day, which is not a trend', () => {
    const chart = buildDryingChart([
      point('North wall', 10, [['2026-08-29T09:00:00-06:00', 28]]),
    ])
    expect(chart.plottable).toBe(false)
  })

  it('ignores points nobody has read yet', () => {
    const chart = buildDryingChart([
      point('North wall', 10, [
        ['2026-08-29T09:00:00-06:00', 28],
        ['2026-08-30T09:00:00-06:00', 12],
      ]),
      point('Never read', 10, []),
    ])
    expect(chart.series).toHaveLength(1)
  })

  it('does not shift the day west of Greenwich', () => {
    // new Date('2026-08-29') parses as UTC midnight and renders as the 28th
    // in Mountain time — this report has shipped that bug once already.
    expect(dayLabel('2026-08-29')).toBe('Aug 29')
  })
})

describe('two points that share a name', () => {
  // Charles's own job has two points called "Drywall 1" and two called
  // "Drywall 2" — a label is free text and repeats. Keying the chart by it
  // collided them: React drops a duplicate key, so one line silently vanished
  // and the legend could not tell the survivors apart.
  const duplicated = [
    {
      id: 'point-a',
      label: 'Drywall 1',
      material: 'Framing',
      dry_standard: 10,
      restoration_readings: [
        { value: 30, taken_at: '2026-08-29T09:00:00-06:00' },
        { value: 22, taken_at: '2026-08-30T09:00:00-06:00' },
      ],
    },
    {
      id: 'point-b',
      label: 'Drywall 1',
      material: 'Framing',
      dry_standard: 10,
      restoration_readings: [
        { value: 28, taken_at: '2026-08-29T09:00:00-06:00' },
        { value: 12, taken_at: '2026-08-30T09:00:00-06:00' },
      ],
    },
  ]

  it('plots both, because they are two different places in the building', () => {
    const chart = buildDryingChart(duplicated)
    expect(chart.series).toHaveLength(2)
  })

  it('gives them distinct identities even with identical labels', () => {
    const chart = buildDryingChart(duplicated)
    expect(chart.series[0].id).not.toBe(chart.series[1].id)
    expect(chart.series[0].label).toBe(chart.series[1].label)
  })
})
