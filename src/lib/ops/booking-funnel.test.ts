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
        ev(id, 'quote_started', 100),
        ev(id, 'calendar_viewed', 100),
      ]),
      // only one of the four continues past the calendar
      ev('a', 'details_started', 100),
      ev('a', 'review_reached', 100),
      ev('a', 'booked', 100),
    ])
    expect(s.biggestDropStep).toBe('details_started')
    expect(s.biggestDropCount).toBe(3)
  })

  it('never blames the browse-to-quote gap for drop-off', () => {
    const s = summarizeFunnel([
      ...Array.from({ length: 20 }, (_, i) => ev(`v${i}`, 'widget_viewed')),
      ev('a', 'quote_started', 100),
      ev('a', 'calendar_viewed', 100),
      ev('a', 'details_started', 100),
      ev('a', 'review_reached', 100),
      ev('a', 'booked', 100),
    ])
    // 20 viewers vs 1 quoter is the largest raw gap but must be ignored
    expect(s.biggestDropStep).toBeNull()
    expect(s.quoteToBookRate).toBe(100)
  })

  it('groups abandoned sessions by normalized referrer', () => {
    const s = summarizeFunnel([
      ev('a', 'quote_started', 100, 'https://nextdoor.com/some/path'),
      ev('b', 'quote_started', 100, 'https://www.google.com/'),
      ev('c', 'quote_started', 100, 'https://nextdoor.com/other'),
      ev('d', 'quote_started', 100, null),
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

  it('handles an empty dataset', () => {
    const s = summarizeFunnel([])
    expect(s.quoteSessions).toBe(0)
    expect(s.quoteToBookRate).toBe(0)
    expect(s.biggestDropStep).toBeNull()
    expect(s.steps).toHaveLength(7)
  })
})
