import { describe, it, expect } from 'vitest'
import {
  buildGscReport,
  buildSiteReport,
  classifyKeyword,
  decliningStreak,
  risingStreak,
  type KeywordSnapshot,
  type SiteSnapshot,
} from './gsc-ranking-report'

const NOW = new Date('2026-08-24T14:31:00Z')

/** The real stored history as of 2026-08-24, newest first. */
const WWW_HISTORY: SiteSnapshot[] = [
  {
    clicks: 49,
    impressions: 2951,
    ctr: 0.0166,
    avg_position: 22.09,
    checked_at: '2026-08-17T14:30:31Z',
  },
  {
    clicks: 64,
    impressions: 2547,
    ctr: 0.02513,
    avg_position: 24.27,
    checked_at: '2026-08-10T14:30:07Z',
  },
  {
    clicks: 64,
    impressions: 2650,
    ctr: 0.02415,
    avg_position: 25.14,
    checked_at: '2026-08-03T14:30:15Z',
  },
  {
    clicks: 64,
    impressions: 2647,
    ctr: 0.02418,
    avg_position: 27.16,
    checked_at: '2026-07-27T14:30:35Z',
  },
  {
    clicks: 56,
    impressions: 2865,
    ctr: 0.01955,
    avg_position: 26.3,
    checked_at: '2026-07-20T14:30:16Z',
  },
  {
    clicks: 42,
    impressions: 2907,
    ctr: 0.01445,
    avg_position: 25.37,
    checked_at: '2026-07-13T14:30:51Z',
  },
  {
    clicks: 42,
    impressions: 2670,
    ctr: 0.01573,
    avg_position: 23.32,
    checked_at: '2026-07-06T14:30:19Z',
  },
  {
    clicks: 38,
    impressions: 2627,
    ctr: 0.01447,
    avg_position: 22.52,
    checked_at: '2026-07-03T04:04:18Z',
  },
]

const WWW_CURRENT = {
  clicks: 37,
  impressions: 2984,
  ctr: 0.0124,
  position: 21.83,
}

describe('streak detection', () => {
  it('counts consecutive declines from the newest value back', () => {
    expect(decliningStreak([38, 42, 42, 56, 64, 64, 64, 49, 37])).toBe(2)
    expect(decliningStreak([10, 9, 8, 7])).toBe(3)
    expect(decliningStreak([5, 6])).toBe(0)
    expect(decliningStreak([7])).toBe(0)
  })

  it('counts consecutive rises', () => {
    expect(risingStreak([38, 42, 45])).toBe(2)
    expect(risingStreak([45, 42])).toBe(0)
  })
})

describe('buildSiteReport on the real August numbers', () => {
  const report = buildSiteReport({
    label: 'Main site',
    current: WWW_CURRENT,
    history: WWW_HISTORY,
    now: NOW,
  })

  it('leads with the visibility-up / clicks-down verdict', () => {
    expect(report.verdict.tone).toBe('warn')
    expect(report.verdict.text).toBe(
      'More people are seeing us. Fewer are clicking.',
    )
    expect(report.explanation).toContain('title and description')
  })

  it('states the click drop in plain counts, not percentages', () => {
    const text = report.lines.join('\n')
    expect(text).toContain('Visits from Google: 37')
    expect(text).toContain('12 fewer than last week (49)')
    expect(text).toContain('27 fewer than a month ago (64)')
    expect(text).toContain('Down 2 weeks in a row.')
  })

  it('recognises the impression and rank records', () => {
    const text = report.lines.join('\n')
    expect(text).toContain('Highest in 9 weeks.')
    expect(text).toContain('Best in 9 weeks.')
  })

  it('spells out that a lower rank number is better', () => {
    expect(report.lines.join('\n')).toContain(
      'Average rank: 21.8 (lower is better)',
    )
  })

  it('builds a 9-week click series ending on the current run', () => {
    expect(report.clickSeries.map((point) => point.value)).toEqual([
      38, 42, 42, 56, 64, 64, 64, 49, 37,
    ])
  })
})

describe('buildSiteReport with too little traffic', () => {
  const report = buildSiteReport({
    label: 'Sightings site',
    current: { clicks: 0, impressions: 3, ctr: 0, position: 29.67 },
    history: [
      {
        clicks: 0,
        impressions: 2,
        ctr: 0,
        avg_position: 8.5,
        checked_at: '2026-08-17T14:30:31Z',
      },
    ],
    now: NOW,
  })

  it('refuses to trend three impressions', () => {
    expect(report.hasEnoughData).toBe(false)
    expect(report.lines.join('\n')).toContain('Too little search traffic')
  })

  it('does not report the meaningless 21-place swing', () => {
    const text = report.lines.join('\n')
    expect(text).not.toContain('21')
    expect(report.metrics).toHaveLength(0)
  })
})

describe('classifyKeyword', () => {
  const ranked = (
    position: number | null,
    impressions: number,
    checked_at: string,
    page: string | null = '/service-areas/colorado-springs',
  ): KeywordSnapshot => ({
    keyword: 'k',
    page,
    clicks: 0,
    impressions,
    avg_position: position,
    checked_at,
  })

  it('flags a page-one keyword as a win', () => {
    const verdict = classifyKeyword({
      keyword: 'briargate cleaning',
      current: {
        keyword: 'briargate cleaning',
        page: '/briargate',
        clicks: 0,
        impressions: 3,
        position: 4.7,
      },
      history: [ranked(5.5, 6, '2026-08-03T14:30:15Z', '/briargate')],
    })
    expect(verdict.marker).toBe('✅')
    expect(verdict.headline).toBe('#5 · page 1')
    expect(verdict.tone).toBe('good')
  })

  it('treats a missing prior position as no data, not as position zero', () => {
    // Regression: a no-impression week used to be stored as avg_position 0, so
    // the next week read it as "#0" and reported a 41-place collapse.
    const verdict = classifyKeyword({
      keyword: 'carpet cleaners colorado springs',
      current: {
        keyword: 'carpet cleaners colorado springs',
        page: '/service-areas/colorado-springs',
        clicks: 0,
        impressions: 5,
        position: 41.8,
      },
      history: [
        ranked(null, 0, '2026-08-17T14:30:31Z', null),
        ranked(41.8, 5, '2026-08-10T14:30:07Z'),
      ],
    })
    expect(verdict.detail).toContain('flat')
    expect(verdict.detail).not.toMatch(/down \d/)
    expect(verdict.tone).toBe('neutral')
  })

  it('reports a real decline against the oldest tracked position', () => {
    const verdict = classifyKeyword({
      keyword: 'best carpet cleaner in colorado springs',
      current: {
        keyword: 'best carpet cleaner in colorado springs',
        page: '/service-areas/colorado-springs',
        clicks: 0,
        impressions: 2,
        position: 67,
      },
      history: [
        ranked(42.8, 4, '2026-08-10T14:30:07Z', '/'),
        ranked(47.2, 6, '2026-07-03T04:04:18Z', '/'),
      ],
    })
    expect(verdict.marker).toBe('🔻')
    expect(verdict.detail).toContain('down 20 spots')
    expect(verdict.detail).toContain('ranking page changed')
  })

  it('distinguishes dropping out from never ranking', () => {
    const droppedOut = classifyKeyword({
      keyword: 'briargate cleaning',
      current: null,
      history: [ranked(3, 1, '2026-08-17T14:30:31Z', '/briargate')],
    })
    expect(droppedOut.headline).toBe('no views this week')
    expect(droppedOut.detail).toContain('#3')

    const neverSeen = classifyKeyword({
      keyword: 'brand new term',
      current: null,
      history: [],
    })
    expect(neverSeen.headline).toBe('no views yet')
  })
})

describe('buildGscReport', () => {
  const report = buildGscReport({
    now: NOW,
    dataThrough: new Date('2026-08-21T14:31:00Z'),
    windowDays: 28,
    main: { current: WWW_CURRENT, history: WWW_HISTORY },
    secondary: {
      label: 'Sightings site',
      current: { clicks: 0, impressions: 3, ctr: 0, position: 29.67 },
      history: [],
    },
    keywords: [
      classifyKeyword({
        keyword: 'briargate cleaning',
        current: null,
        history: [
          {
            keyword: 'briargate cleaning',
            page: '/briargate',
            clicks: 0,
            impressions: 1,
            avg_position: 3,
            checked_at: '2026-08-17T14:30:31Z',
          },
        ],
      }),
    ],
    keywordClicks: 0,
    footerNote: 'Source: Google Search Console',
  })

  it('drops the WoW / MoM jargon entirely', () => {
    expect(report.text).not.toMatch(/WoW|MoM/)
  })

  it('dates the window so the reader knows how fresh it is', () => {
    expect(report.text).toContain('week of Aug 24')
    expect(report.text).toContain('data through Aug 21')
  })

  it('says outright that tracked keywords produced no clicks', () => {
    expect(report.text).toContain('None of them brought a single click')
  })

  it('keeps the caption inside Telegram\u2019s 1024-character limit', () => {
    expect(report.caption.length).toBeLessThanOrEqual(1024)
    expect(report.caption).toContain('Fewer are clicking')
  })

  it('hands the image the same verdict and series as the text', () => {
    expect(report.card.verdict?.text).toBe(
      'More people are seeing us. Fewer are clicking.',
    )
    expect(report.card.metrics).toHaveLength(4)
    expect(report.card.series?.points.at(-1)?.value).toBe(37)
  })
})
