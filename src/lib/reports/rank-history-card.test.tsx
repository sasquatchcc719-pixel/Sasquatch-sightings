import { mkdir, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  buildRankHistoryGeometry,
  renderRankHistoryCardPng,
  type RankHistoryPanel,
  type RankHistoryPoint,
} from './rank-history-card'

const point = (
  date: string,
  rank: number | null,
  status: RankHistoryPoint['status'] = 'ranked',
): RankHistoryPoint => ({ date, rank, status })

describe('rank history geometry', () => {
  it('puts #1 above #20 and preserves a single isolated observation', () => {
    const result = buildRankHistoryGeometry(
      [point('2026-10-17', 20), point('2026-10-18', 1)],
      20,
      '2026-10-18',
    )
    expect(result.markers[1].y).toBeLessThan(result.markers[0].y)
    const single = buildRankHistoryGeometry(
      [point('2026-10-18', 1)],
      20,
      '2026-10-18',
    )
    expect(single.markers).toHaveLength(1)
    expect(single.path).toMatch(/^M /)
  })

  it('breaks lines at unknown readings and at missing calendar days', () => {
    const unknown = buildRankHistoryGeometry(
      [
        point('2026-10-14', 3),
        point('2026-10-15', null, 'unknown'),
        point('2026-10-16', 2),
        point('2026-10-18', 1),
      ],
      20,
      '2026-10-18',
    )
    expect(unknown.path.match(/M /g)).toHaveLength(3)
    expect(unknown.path).not.toContain('L ')
    expect(unknown.markers).toHaveLength(3)
  })

  it('draws confirmed outside readings separately and never upgrades a shallow miss', () => {
    const result = buildRankHistoryGeometry(
      [
        point('2026-10-16', 10),
        { ...point('2026-10-17', null, 'outside'), depth: 20 },
        point('2026-10-18', 4),
      ],
      20,
      '2026-10-18',
    )
    expect(result.markers[1].outside).toBe(true)
    expect(result.markers[1].y).toBeGreaterThan(result.markers[0].y)
    expect(result.path.match(/M /g)).toHaveLength(2)
    const shallow = buildRankHistoryGeometry(
      [{ ...point('2026-10-18', null, 'outside'), depth: 9 }],
      50,
      '2026-10-18',
    )
    expect(shallow.markers).toHaveLength(0)
  })

  it('uses actual date spacing, excludes old observations, and supports weekly decimal positions', () => {
    const result = buildRankHistoryGeometry(
      [
        point('2026-06-01', 1),
        point('2026-10-04', 8.4),
        point('2026-10-11', 4.2),
        point('2026-10-18', 2.1),
      ],
      50,
      '2026-10-18',
      90,
      7,
    )
    expect(result.markers).toHaveLength(3)
    expect(result.path.match(/L /g)).toHaveLength(2)
    const firstGap = result.markers[1].x - result.markers[0].x
    const secondGap = result.markers[2].x - result.markers[1].x
    expect(firstGap).toBeCloseTo(secondGap)
  })
})

const towns = [
  'Monument',
  'Palmer Lake',
  'Castle Rock',
  'Larkspur',
  'Colorado Springs',
]
const colors = ['#38bdf8', '#34d399', '#fbbf24', '#c084fc', '#fb7185']
const fixturePanels: RankHistoryPanel[] = [
  {
    title: 'Google Maps · town-center ranks',
    subtitle: 'TEST DATA · Daily fixed-location observations · last 30 days',
    maxRank: 20,
    series: towns.map((town, index) => ({
      town,
      color: colors[index],
      latestLabel:
        index === 2
          ? '>20 · checked through #20'
          : `#${[3, 1, 20, 7, 14][index]} · latest daily check`,
      points: Array.from({ length: 30 }, (_, offset) => {
        const date = new Date(Date.UTC(2026, 8, 19 + offset))
          .toISOString()
          .slice(0, 10)
        if (index === 2)
          return { date, rank: null, status: 'outside' as const, depth: 20 }
        if (index === 3 && offset > 11 && offset < 16)
          return point(date, null, 'unknown')
        return point(
          date,
          Math.max(1, [3, 1, 20, 7, 14][index] + Math.floor((29 - offset) / 8)),
        )
      }),
    })),
  },
  {
    title: 'Website organic · Google Search',
    subtitle: 'TEST DATA · Google-recorded weekly average positions · 90 days',
    maxRank: 50,
    windowDays: 90,
    intervalDays: 7,
    series: towns.map((town, index) => ({
      town,
      color: colors[index],
      latestLabel: `Avg #${(3.2 + index * 4).toFixed(1)} · 32 impressions`,
      points: Array.from({ length: 12 }, (_, offset) =>
        point(
          new Date(Date.UTC(2026, 7, 2 + offset * 7))
            .toISOString()
            .slice(0, 10),
          3.2 + index * 4 + (11 - offset) * 0.6,
        ),
      ),
    })),
  },
]

describe('renderRankHistoryCardPng', () => {
  it('renders two readable panels and can save an explicitly synthetic visual fixture', async () => {
    const png = await renderRankHistoryCardPng({
      date: '2026-10-18',
      panels: fixturePanels,
      note: 'SYNTHETIC TEST FIXTURE ONLY. These positions are invented to test rendering, gaps and axes; they are not business results.',
    })
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(900)
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(1600)
    expect(png.readUInt32BE(20)).toBeLessThanOrEqual(1900)
    expect(png.length).toBeGreaterThan(20_000)
    if (process.env.RANK_HISTORY_WRITE_FIXTURE === '1') {
      await mkdir('output/radar-followup-2026-10-18', { recursive: true })
      await writeFile('output/radar-followup-2026-10-18/render-test.png', png)
    }
  })

  it('increases image height for a third panel without clipping the footer', async () => {
    const png = await renderRankHistoryCardPng({
      date: '2026-10-18',
      panels: [
        ...fixturePanels,
        { ...fixturePanels[0], title: 'Explicit city search · new baseline' },
      ],
    })
    expect(png.readUInt32BE(20)).toBeGreaterThan(2300)
  })
})
