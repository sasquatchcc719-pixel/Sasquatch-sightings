import { describe, expect, it } from 'vitest'
import type { MarketingWeeklyRollupRow } from './marketing-rollup'
import {
  buildBusinessInsights,
  completedWeekStarts,
  isActiveServiceTown,
  latestMapWeekRows,
  mapVisibility,
  scopedWeekRows,
  summarizeRollup,
} from './marketing-rollup-insights'

function row(
  overrides: Partial<MarketingWeeklyRollupRow>,
): MarketingWeeklyRollupRow {
  return {
    week_start: '2026-08-03',
    week_end: '2026-08-09',
    town_slug: 'business-wide',
    spend: 0,
    spend_breakdown: {},
    spend_line_count: 0,
    rank_best: null,
    rank_median: null,
    rank_points: 0,
    rank_found: 0,
    gsc_impressions: 0,
    gsc_clicks: 0,
    gsc_data_through: '2026-08-07',
    quote_sessions: 0,
    residential_jobs: 0,
    residential_revenue: 0,
    commercial_jobs: 0,
    commercial_revenue: 0,
    review_delta: null,
    events: [],
    built_at: '2026-08-10T12:00:00Z',
    ...overrides,
  }
}

describe('marketing rollup business interpretation', () => {
  const rows = [
    row({
      spend: 20.26,
      spend_breakdown: { 'Facebook / Meta': 20.26 },
      spend_line_count: 2,
      gsc_impressions: 220,
      gsc_clicks: 4,
      quote_sessions: 8,
      review_delta: 3,
    }),
    row({
      town_slug: 'monument',
      residential_jobs: 5,
      residential_revenue: 2416,
      commercial_jobs: 1,
      commercial_revenue: 440.51,
      quote_sessions: 1,
    }),
    row({
      town_slug: 'colorado-springs',
      residential_jobs: 6,
      residential_revenue: 2269,
      gsc_impressions: 499,
      gsc_clicks: 1,
      quote_sessions: 2,
    }),
    row({
      town_slug: 'palmer-lake',
      residential_jobs: 2,
      residential_revenue: 580,
      commercial_jobs: 1,
      commercial_revenue: 1300.95,
      gsc_impressions: 4,
    }),
    row({
      town_slug: 'larkspur',
      gsc_impressions: 42,
      gsc_clicks: 1,
    }),
    row({
      town_slug: 'castle-pines',
      rank_points: 84,
      rank_found: 17,
      rank_best: 13,
      rank_median: 21,
    }),
  ]

  it('uses only completed weeks and the five actual service markets', () => {
    expect(completedWeekStarts(rows, '2026-08-10')).toEqual(['2026-08-03'])
    expect(isActiveServiceTown('monument')).toBe(true)
    expect(isActiveServiceTown('castle-pines')).toBe(false)
    expect(isActiveServiceTown('manitou-springs')).toBe(false)

    const scoped = scopedWeekRows(rows, '2026-08-03', 'all')
    expect(scoped.map((item) => item.town_slug)).not.toContain('castle-pines')
    expect(scoped).toHaveLength(5)
  })

  it('produces plain business totals without treating scan noise as a market', () => {
    const summary = summarizeRollup(scopedWeekRows(rows, '2026-08-03', 'all'))
    expect(summary).toMatchObject({
      spend: 20.26,
      spendBreakdown: { 'Facebook / Meta': 20.26 },
      spendLineCount: 2,
      residentialJobs: 13,
      residentialRevenue: 5265,
      commercialJobs: 2,
      commercialRevenue: 1741.46,
      searchAppearances: 765,
      googleVisits: 6,
      quoteSessions: 11,
      reviewDelta: 3,
    })
  })

  it('labels a map sample in human terms', () => {
    const visibility = mapVisibility(rows[5])
    expect(visibility.percent).toBeCloseTo(20.238)
    expect(visibility).toMatchObject({
      status: 'Weak',
      typical: 'usually outside the first 20 results',
    })
  })

  it('keeps the latest map sample to active service markets', () => {
    const mapRows = latestMapWeekRows(
      [
        ...rows,
        row({
          week_start: '2026-08-10',
          week_end: '2026-08-16',
          town_slug: 'monument',
          rank_points: 87,
          rank_found: 64,
        }),
        row({
          week_start: '2026-08-10',
          week_end: '2026-08-16',
          town_slug: 'manitou-springs',
          rank_points: 17,
          rank_found: 0,
        }),
      ],
      'all',
    )
    expect(mapRows.map((item) => item.town_slug)).toEqual(['monument'])
  })

  it('turns weak search engagement and real QuickBooks spend into explicit actions', () => {
    const current = summarizeRollup(scopedWeekRows(rows, '2026-08-03', 'all'))
    const insights = buildBusinessInsights({
      current,
      previous: null,
      serviceRows: scopedWeekRows(rows, '2026-08-03', 'all').filter(
        (item) => item.town_slug !== 'business-wide',
      ),
      mapRows: [],
      allServiceAreas: true,
    })
    expect(insights.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        'Google visibility is not turning into many website visits',
        'Facebook / Meta was the largest marketing cost this week',
        'Monument produced the most completed residential revenue',
      ]),
    )
    expect(insights.every((item) => item.nextStep.length > 20)).toBe(true)
  })
})
