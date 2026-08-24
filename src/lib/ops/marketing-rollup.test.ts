// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_WIDE,
  UNKNOWN_TOWN,
  buildMarketingRollupDigest,
  buildWeeklyRollup,
  completedWeeks,
  inferTownFromPath,
  mountainDateKey,
  resolveJobTown,
  weekForDateKey,
  weeksThroughCurrent,
} from './marketing-rollup'

const window = { start: '2026-08-03', end: '2026-08-09' }

describe('marketing weekly rollup dates', () => {
  it('uses Monday-Sunday Mountain weeks across UTC and year boundaries', () => {
    expect(mountainDateKey('2026-08-10T05:30:00Z')).toBe('2026-08-09')
    expect(mountainDateKey('2026-08-10T06:30:00Z')).toBe('2026-08-10')
    expect(weekForDateKey('2027-01-01')).toEqual({
      start: '2026-12-28',
      end: '2027-01-03',
    })
    expect(weeksThroughCurrent(1, new Date('2027-01-01T18:00:00Z'))[0]).toEqual(
      {
        start: '2026-12-28',
        end: '2027-01-03',
      },
    )
    expect(completedWeeks(1, new Date('2027-01-01T18:00:00Z'))[0]).toEqual({
      start: '2026-12-21',
      end: '2026-12-27',
    })
  })
})

describe('town attribution', () => {
  it('maps service-area and neighborhood pages without guessing generic pages', () => {
    expect(
      inferTownFromPath(
        'https://www.sasquatchcarpet.com/service-areas/monument?utm=x',
      ),
    ).toBe('monument')
    expect(
      inferTownFromPath('/carpet-cleaning-briargate-colorado-springs'),
    ).toBe('colorado-springs')
    expect(inferTownFromPath('/services/carpet-cleaning')).toBeNull()
  })

  it('recovers a job town from the city when town_slug was never written', () => {
    expect(resolveJobTown(null, 'Castle Rock')).toBe('castle-rock')
    expect(resolveJobTown(null, 'Monument')).toBe('monument')
    expect(resolveJobTown(null, 'Colorado Springs')).toBe('colorado-springs')
    expect(resolveJobTown('monument', 'Colorado Springs')).toBe('monument')
    expect(resolveJobTown(null, null)).toBeNull()
  })
})

describe('buildWeeklyRollup', () => {
  const rows = buildWeeklyRollup({
    window,
    builtAt: '2026-08-10T16:00:00.000Z',
    gscDataThrough: '2026-08-07',
    campaignCosts: [
      {
        id: 'cost-link-1',
        source_type: 'quickbooks',
        source_id: 'Purchase:abc:0',
        amount: 101,
        occurred_on: '2026-08-04',
        town_slugs: [],
        channel: 'Google ads',
      },
      // Same QB line linked to a duplicate campaign: count it once.
      {
        id: 'cost-link-2',
        source_type: 'quickbooks',
        source_id: 'Purchase:abc:0',
        amount: 101,
        occurred_on: '2026-08-04',
        town_slugs: [],
        channel: 'Google ads',
      },
      {
        id: 'targeted',
        source_type: 'manual',
        source_id: null,
        amount: 10.01,
        occurred_on: '2026-08-09',
        town_slugs: ['monument', 'palmer-lake'],
      },
      {
        id: 'outside',
        source_type: 'manual',
        source_id: null,
        amount: 999,
        occurred_on: '2026-08-10',
        town_slugs: [],
      },
    ],
    rankPoints: [
      {
        occurred_at: '2026-08-05T18:00:00Z',
        lat: 39.0908,
        lng: -104.8698,
        rank: 1,
      },
      {
        occurred_at: '2026-08-05T18:00:00Z',
        lat: 39.0907,
        lng: -104.8697,
        rank: null,
      },
      {
        occurred_at: '2026-08-05T18:00:00Z',
        lat: 39.0909,
        lng: -104.8699,
        rank: 2,
        found: false,
      },
      // Rank zero is not a real rank.
      {
        occurred_at: '2026-08-05T18:00:00Z',
        lat: 39.0906,
        lng: -104.8696,
        rank: 0,
      },
    ],
    gscRows: [
      {
        page: 'https://www.sasquatchcarpet.com/service-areas/monument',
        impressions: 100,
        clicks: 4,
        ctr: 0.04,
        position: 8,
      },
      {
        page: 'https://www.sasquatchcarpet.com/carpet-cleaning-briargate-colorado-springs',
        impressions: 50,
        clicks: 2,
        ctr: 0.04,
        position: 5,
      },
      {
        page: 'https://www.sasquatchcarpet.com/',
        impressions: 25,
        clicks: 1,
        ctr: 0.04,
        position: 3,
      },
    ],
    quoteSessions: [
      {
        session_id: 'monument-landing',
        quote_created_at: '2026-08-05T18:00:00Z',
        is_test: false,
        appointment_town_slug: null,
        landing_paths: ['/service-areas/monument'],
      },
      {
        session_id: 'internal-test',
        quote_created_at: '2026-08-05T18:00:00Z',
        is_test: true,
        appointment_town_slug: 'monument',
        landing_paths: ['/service-areas/monument'],
      },
      {
        session_id: 'generic',
        quote_created_at: '2026-08-06T18:00:00Z',
        is_test: false,
        appointment_town_slug: null,
        landing_paths: ['/'],
      },
      {
        session_id: 'booked-town-wins',
        quote_created_at: '2026-08-07T18:00:00Z',
        is_test: false,
        appointment_town_slug: 'castle-rock',
        landing_paths: ['/'],
      },
    ],
    appointments: [
      {
        appointment_date: '2026-08-05',
        status: 'completed',
        kind: 'service',
        quoted_total: 400,
        town_slug: 'monument',
        business_name: null,
        batch_billing_customer_id: null,
        is_internal: false,
      },
      {
        appointment_date: '2026-08-06',
        status: 'completed',
        kind: 'service',
        quoted_total: 1000,
        town_slug: 'palmer-lake',
        business_name: 'Commercial account',
        batch_billing_customer_id: null,
        is_internal: false,
      },
      {
        appointment_date: '2026-08-07',
        status: 'cancelled',
        kind: 'service',
        quoted_total: 500,
        town_slug: 'monument',
        business_name: null,
        batch_billing_customer_id: null,
        is_internal: false,
      },
      {
        appointment_date: '2026-08-08',
        status: 'completed',
        kind: 'service',
        quoted_total: 1,
        town_slug: 'monument',
        business_name: null,
        batch_billing_customer_id: null,
        is_internal: false,
      },
      {
        appointment_date: '2026-08-08',
        status: 'completed',
        kind: 'service',
        quoted_total: 700,
        town_slug: null,
        business_name: null,
        batch_billing_customer_id: null,
        is_internal: true,
      },
    ],
    reviewSnapshots: [
      { captured_on: '2026-08-02', total_on_google: 80 },
      { captured_on: '2026-08-05', total_on_google: 81 },
      { captured_on: '2026-08-08', total_on_google: 82 },
    ],
    events: [
      {
        id: 'town-event',
        occurred_at: '2026-08-05T18:00:00Z',
        category: 'gbp',
        title: 'Town change',
        detail: null,
        town_slugs: ['monument'],
      },
      {
        id: 'wide-event',
        occurred_at: '2026-08-06T18:00:00Z',
        category: 'instrument',
        title: 'Measurement change',
        detail: null,
        town_slugs: [],
      },
    ],
  })

  const byTown = new Map(rows.map((row) => [row.town_slug, row]))

  it('creates one stable row for every canonical, business-wide, and unknown scope', () => {
    expect(rows).toHaveLength(15)
    expect(byTown.has(BUSINESS_WIDE)).toBe(true)
    expect(byTown.has(UNKNOWN_TOWN)).toBe(true)
  })

  it('deduplicates business-wide spend and penny-splits targeted spend', () => {
    expect(byTown.get(BUSINESS_WIDE)?.spend).toBe(101)
    expect(byTown.get(BUSINESS_WIDE)?.spend_breakdown).toEqual({
      'Google ads': 101,
    })
    expect(byTown.get(BUSINESS_WIDE)?.spend_line_count).toBe(1)
    expect(byTown.get('monument')?.spend).toBe(5.01)
    expect(byTown.get('monument')?.spend_breakdown).toEqual({
      'Campaign labor & manual costs': 5.01,
    })
    expect(byTown.get('palmer-lake')?.spend).toBe(5)
    expect(rows.reduce((sum, row) => sum + row.spend, 0)).toBe(111.01)
  })

  it('uses misses in the median while keeping found coverage explicit', () => {
    expect(byTown.get('monument')).toMatchObject({
      rank_best: 1,
      rank_median: 21,
      rank_points: 4,
      rank_found: 1,
    })
  })

  it('attributes demand without multiplying generic traffic across towns', () => {
    expect(byTown.get('monument')).toMatchObject({
      gsc_impressions: 100,
      gsc_clicks: 4,
      quote_sessions: 1,
    })
    expect(byTown.get('colorado-springs')).toMatchObject({
      gsc_impressions: 50,
      gsc_clicks: 2,
    })
    expect(byTown.get('castle-rock')?.quote_sessions).toBe(1)
    expect(byTown.get(BUSINESS_WIDE)).toMatchObject({
      gsc_impressions: 25,
      gsc_clicks: 1,
      quote_sessions: 1,
      gsc_data_through: '2026-08-07',
    })
    expect(rows.reduce((sum, row) => sum + row.quote_sessions, 0)).toBe(3)
  })

  it('keeps completed residential and commercial returns separate', () => {
    expect(byTown.get('monument')).toMatchObject({
      residential_jobs: 1,
      residential_revenue: 400,
      commercial_jobs: 0,
    })
    expect(byTown.get('palmer-lake')).toMatchObject({
      residential_jobs: 0,
      commercial_jobs: 1,
      commercial_revenue: 1000,
    })
  })

  it('uses a pre-week review baseline and scopes annotations', () => {
    expect(byTown.get(BUSINESS_WIDE)?.review_delta).toBe(2)
    expect(byTown.get(BUSINESS_WIDE)?.events.map((event) => event.id)).toEqual([
      'wide-event',
    ])
    expect(byTown.get('monument')?.events.map((event) => event.id)).toEqual([
      'town-event',
    ])
  })

  it('builds a compact digest from the same rows', () => {
    const digest = buildMarketingRollupDigest(rows)
    expect(digest).toContain('2026-08-03 to 2026-08-09')
    expect(digest).toContain('data through 2026-08-07')
    expect(digest).toContain('Completed commercial work')
    expect(digest).toContain(
      'Reconciled marketing spend: $111, anchored by 1 QuickBooks expense lines plus separately recorded campaign costs',
    )
    expect(digest).toContain('does not mean every quote was finished or booked')
    expect(digest).not.toContain('impr /')
    expect(digest.length).toBeLessThanOrEqual(4096)
  })
})
