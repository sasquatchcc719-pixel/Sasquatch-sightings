import { describe, expect, it } from 'vitest'
import { summarizeFunnel } from './booking-funnel'

const ev = (
  session_id: string,
  step: string,
  quote_total = 0,
  referrer: string | null = null,
) => ({
  session_id,
  step,
  quote_total,
  referrer,
  created_at: '2026-07-16T12:00:00.000Z',
})

const datedEv = (
  session_id: string,
  step: string,
  quote_total: number,
  date: string,
) => ({
  ...ev(session_id, step, quote_total),
  created_at: `${date}T12:00:00.000Z`,
})

describe('summarizeFunnel', () => {
  it('counts sessions per step and computes quote-to-book rate', () => {
    const s = summarizeFunnel([
      // booked session
      ev('a', 'widget_viewed'),
      ev('a', 'quote_started', 300),
      ev('a', 'calendar_viewed', 300),
      ev('a', 'details_started', 300),
      ev('a', 'review_reached', 300),
      ev('a', 'booked', 300),
      // abandoned at calendar
      ev('b', 'widget_viewed'),
      ev('b', 'quote_started', 500),
      ev('b', 'calendar_viewed', 500),
      // browsed but never quoted
      ev('c', 'widget_viewed'),
    ])

    expect(s.steps[1].sessions).toBe(3) // widget_viewed
    expect(s.quoteSessions).toBe(2)
    expect(s.bookedSessions).toBe(1)
    expect(s.quoteToBookRate).toBe(50)
    expect(s.abandonedQuotes).toBe(1)
    expect(s.abandonedQuoteValue).toBe(500)
    expect(s.bookedQuoteValue).toBe(300)
    expect(s.avgAbandonedQuote).toBe(500)
  })

  it('uses the highest quote value seen for a session', () => {
    const s = summarizeFunnel([
      ev('a', 'quote_started', 200),
      ev('a', 'calendar_viewed', 450),
    ])
    expect(s.abandonedQuoteValue).toBe(450)
  })

  it('identifies the biggest drop-off step after the quote', () => {
    const s = summarizeFunnel([
      ...['a', 'b', 'c', 'd'].flatMap((id) => [
        ev(id, 'quote_started', 200),
        ev(id, 'calendar_viewed', 200),
      ]),
      // only one of the four continues past the calendar
      ev('a', 'details_started', 200),
      ev('a', 'review_reached', 200),
      ev('a', 'booked', 200),
    ])
    expect(s.biggestDropStep).toBe('details_started')
    expect(s.biggestDropCount).toBe(3)
  })

  it('never blames the browse-to-quote gap for drop-off', () => {
    const s = summarizeFunnel([
      ...Array.from({ length: 20 }, (_, i) => ev(`v${i}`, 'widget_viewed')),
      ev('a', 'quote_started', 200),
      ev('a', 'calendar_viewed', 200),
      ev('a', 'details_started', 200),
      ev('a', 'review_reached', 200),
      ev('a', 'booked', 200),
    ])
    // 20 viewers vs 1 quoter is the largest raw gap but must be ignored
    expect(s.biggestDropStep).toBeNull()
    expect(s.quoteToBookRate).toBe(100)
  })

  it('groups abandoned sessions by normalized referrer', () => {
    const s = summarizeFunnel([
      ev('a', 'quote_started', 200, 'https://nextdoor.com/some/path'),
      ev('b', 'quote_started', 200, 'https://www.google.com/'),
      ev('c', 'quote_started', 200, 'https://nextdoor.com/other'),
      ev('d', 'quote_started', 200, null),
    ])
    expect(s.topAbandonedReferrers[0]).toEqual({
      referrer: 'nextdoor.com',
      sessions: 2,
    })
    expect(
      s.topAbandonedReferrers.some((r) => r.referrer === 'Direct / unknown'),
    ).toBe(true)
  })

  it('computes visitor → quote → book rates', () => {
    const s = summarizeFunnel([
      ...Array.from({ length: 10 }, (_, i) => ev(`v${i}`, 'site_visit')),
      ev('v0', 'quote_started', 300),
      ev('v1', 'quote_started', 200),
      ev('v0', 'booked', 300),
    ])
    expect(s.visitorSessions).toBe(10)
    expect(s.quoteSessions).toBe(2)
    expect(s.bookedSessions).toBe(1)
    expect(s.visitToQuoteRate).toBe(20)
    expect(s.visitToBookRate).toBe(10)
    expect(s.quoteToBookRate).toBe(50)
  })

  it('does not count a sub-minimum cart click as a built quote', () => {
    const s = summarizeFunnel([
      ev('partial', 'site_visit'),
      ev('partial', 'widget_viewed'),
      ev('partial', 'quote_started', 46),
      ev('qualified', 'site_visit'),
      ev('qualified', 'widget_viewed'),
      ev('qualified', 'quote_started', 250),
      ev('qualified', 'calendar_viewed', 250),
    ])

    expect(s.quoteSessions).toBe(1)
    expect(s.abandonedQuotes).toBe(1)
    expect(s.abandonedQuoteValue).toBe(250)
    expect(s.steps.find((step) => step.step === 'quote_started')).toMatchObject(
      {
        sessions: 1,
        pctFromPrevious: 50,
      },
    )
    expect(
      s.steps.find((step) => step.step === 'calendar_viewed'),
    ).toMatchObject({
      sessions: 1,
      pctFromPrevious: 100,
    })
  })

  it('builds a continuous seven-day trend from qualified-quote cohorts', () => {
    const s = summarizeFunnel(
      [
        datedEv('booked', 'quote_started', 300, '2026-07-02'),
        datedEv('booked', 'booked', 300, '2026-07-03'),
        datedEv('lost', 'quote_started', 500, '2026-07-07'),
        datedEv('partial', 'quote_started', 46, '2026-07-07'),
      ],
      {
        sinceDate: '2026-07-01',
        endDate: '2026-07-09',
        windowDays: 9,
      },
    )

    expect(s.trend).toHaveLength(3)
    expect(s.trend.find((point) => point.date === '2026-07-07')).toEqual({
      date: '2026-07-07',
      quotes: 2,
      booked: 1,
      unbookedQuotes: 1,
      quoteToBookRate: 50,
      unbookedQuoteValue: 500,
    })
    expect(s.trend.find((point) => point.date === '2026-07-09')).toEqual({
      date: '2026-07-09',
      quotes: 1,
      booked: 0,
      unbookedQuotes: 1,
      quoteToBookRate: 0,
      unbookedQuoteValue: 500,
    })
  })

  it('handles an empty dataset', () => {
    const s = summarizeFunnel([])
    expect(s.quoteSessions).toBe(0)
    expect(s.quoteToBookRate).toBe(0)
    expect(s.biggestDropStep).toBeNull()
    expect(s.steps).toHaveLength(7)
    expect(s.trend).toEqual([])
  })
})
