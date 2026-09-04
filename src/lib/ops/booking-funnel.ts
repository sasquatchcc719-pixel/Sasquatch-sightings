import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Booking-widget funnel: how many visitors configure a quote (an "estimate")
 * and how many of those actually book.
 *
 * Steps are ordered; each session records at most one row per step, so a
 * session that reaches `booked` also has rows for the earlier steps it passed
 * through. Counting is therefore "sessions that reached at least this step".
 */

export const FUNNEL_STEPS = [
  'site_visit',
  'widget_viewed',
  'quote_started',
  'calendar_viewed',
  'details_started',
  'review_reached',
  'booked',
] as const

export type FunnelStep = (typeof FUNNEL_STEPS)[number]

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  site_visit: 'Visited the website',
  widget_viewed: 'Opened the booking tool',
  quote_started: 'Built a quote (estimate)',
  calendar_viewed: 'Looked at the calendar',
  details_started: 'Started entering details',
  review_reached: 'Reached final review',
  booked: 'Booked the job',
}

export function isFunnelStep(value: string): value is FunnelStep {
  return (FUNNEL_STEPS as readonly string[]).includes(value)
}

export type FunnelStepSummary = {
  step: FunnelStep
  label: string
  sessions: number
  /** % of sessions from the immediately previous step that reached this step. */
  pctFromPrevious: number
  /** Sessions lost between the previous step and this one. */
  droppedFromPrevious: number
}

export type FunnelTrendPoint = {
  date: string
  /** Qualified-quote cohorts started during the trailing seven days. */
  quotes: number
  /** Those cohorts that eventually completed a booking. */
  booked: number
  unbookedQuotes: number
  quoteToBookRate: number | null
  unbookedQuoteValue: number
}

export type BookingFunnelSummary = {
  sinceDate: string | null
  windowDays: number | null
  steps: FunnelStepSummary[]
  visitorSessions: number
  quoteSessions: number
  bookedSessions: number
  /** booked / quote_started, as percent 0–100 — the headline number. */
  quoteToBookRate: number
  /** quote_started / site_visit, as percent 0–100. */
  visitToQuoteRate: number
  /** booked / site_visit, as percent 0–100 — overall site conversion. */
  visitToBookRate: number
  abandonedQuotes: number
  /** Sum of the best quote value for sessions that quoted but never booked. */
  abandonedQuoteValue: number
  bookedQuoteValue: number
  avgAbandonedQuote: number
  /** Step where the most sessions were lost (null when there is no data). */
  biggestDropStep: FunnelStep | null
  biggestDropCount: number
  topAbandonedReferrers: { referrer: string; sessions: number }[]
  /** Daily points calculated as trailing seven-day qualified-quote cohorts. */
  trend: FunnelTrendPoint[]
}

type EventRow = {
  session_id: string
  step: string
  quote_total: number | string | null
  referrer: string | null
  created_at: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const ONLINE_BOOKING_MINIMUM = 150
const TREND_WINDOW_DAYS = 7
const POST_QUOTE_STEPS = new Set<FunnelStep>([
  'calendar_viewed',
  'details_started',
  'review_reached',
  'booked',
])

function normalizeReferrer(raw: string | null): string {
  const value = String(raw || '').trim()
  if (!value) return 'Direct / unknown'
  try {
    const host = new URL(value).hostname.replace(/^www\./, '')
    if (host.includes('sasquatchcarpet')) return 'Own site'
    return host
  } catch {
    return value.slice(0, 60)
  }
}

export function summarizeFunnel(
  rows: EventRow[],
  options?: {
    sinceDate?: string | null
    endDate?: string | null
    windowDays?: number | null
  },
): BookingFunnelSummary {
  const stepsBySession = new Map<string, Set<string>>()
  const bestQuoteBySession = new Map<string, number>()
  const referrerBySession = new Map<string, string>()

  for (const row of rows) {
    let steps = stepsBySession.get(row.session_id)
    if (!steps) {
      steps = new Set<string>()
      stepsBySession.set(row.session_id, steps)
    }
    steps.add(row.step)

    const quote = Number(row.quote_total || 0)
    if (quote > (bestQuoteBySession.get(row.session_id) ?? 0)) {
      bestQuoteBySession.set(row.session_id, quote)
    }
    if (row.referrer && !referrerBySession.has(row.session_id)) {
      referrerBySession.set(row.session_id, normalizeReferrer(row.referrer))
    }
  }

  // Older website builds recorded quote_started on the first + button press,
  // even when the cart was far below the $150 online minimum. Treat a session
  // as a real quote only once it reached a bookable total (or a later step,
  // which itself proves the minimum gate was passed).
  const qualifiedQuoteSessions = new Set<string>()
  for (const [sessionId, steps] of stepsBySession) {
    const reachedPostQuoteStep = [...POST_QUOTE_STEPS].some((step) =>
      steps.has(step),
    )
    if (
      steps.has('quote_started') &&
      ((bestQuoteBySession.get(sessionId) ?? 0) >= ONLINE_BOOKING_MINIMUM ||
        reachedPostQuoteStep)
    ) {
      qualifiedQuoteSessions.add(sessionId)
    }
  }

  const counts = new Map<FunnelStep, number>()
  for (const step of FUNNEL_STEPS) counts.set(step, 0)
  for (const [sessionId, steps] of stepsBySession) {
    for (const step of FUNNEL_STEPS) {
      const requiresQualifiedQuote =
        step === 'quote_started' || POST_QUOTE_STEPS.has(step)
      if (
        steps.has(step) &&
        (!requiresQualifiedQuote || qualifiedQuoteSessions.has(sessionId))
      ) {
        counts.set(step, (counts.get(step) ?? 0) + 1)
      }
    }
  }

  const visitorSessions = counts.get('site_visit') ?? 0
  const quoteSessions = counts.get('quote_started') ?? 0
  const bookedSessions = counts.get('booked') ?? 0

  let biggestDropStep: FunnelStep | null = null
  let biggestDropCount = 0
  const stepSummaries: FunnelStepSummary[] = FUNNEL_STEPS.map((step, index) => {
    const sessions = counts.get(step) ?? 0
    const previous = index > 0 ? (counts.get(FUNNEL_STEPS[index - 1]) ?? 0) : 0
    const dropped = index > 0 ? Math.max(previous - sessions, 0) : 0
    // Only measure drop-off from the quote step onward — the gaps from
    // visiting the site and opening the tool are browsing, not abandonment.
    if (index > 2 && dropped > biggestDropCount) {
      biggestDropCount = dropped
      biggestDropStep = step
    }
    return {
      step,
      label: FUNNEL_STEP_LABELS[step],
      sessions,
      pctFromPrevious:
        index === 0
          ? sessions > 0
            ? 100
            : 0
          : previous > 0
            ? round1((sessions / previous) * 100)
            : 0,
      droppedFromPrevious: dropped,
    }
  })

  let abandonedQuoteValue = 0
  let bookedQuoteValue = 0
  let abandonedQuotes = 0
  const abandonedReferrers = new Map<string, number>()

  for (const [sessionId, steps] of stepsBySession) {
    if (!qualifiedQuoteSessions.has(sessionId)) continue
    const value = bestQuoteBySession.get(sessionId) ?? 0
    if (steps.has('booked')) {
      bookedQuoteValue += value
    } else {
      abandonedQuotes++
      abandonedQuoteValue += value
      const ref = referrerBySession.get(sessionId) ?? 'Direct / unknown'
      abandonedReferrers.set(ref, (abandonedReferrers.get(ref) ?? 0) + 1)
    }
  }

  const topAbandonedReferrers = [...abandonedReferrers.entries()]
    .map(([referrer, sessions]) => ({ referrer, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 5)

  const quoteDateBySession = new Map<string, string>()
  for (const row of rows) {
    if (!qualifiedQuoteSessions.has(row.session_id)) continue
    const provesQualification =
      (row.step === 'quote_started' &&
        Number(row.quote_total || 0) >= ONLINE_BOOKING_MINIMUM) ||
      POST_QUOTE_STEPS.has(row.step as FunnelStep)
    if (!provesQualification) continue

    const date = row.created_at.slice(0, 10)
    const current = quoteDateBySession.get(row.session_id)
    if (!current || date < current) quoteDateBySession.set(row.session_id, date)
  }

  const dailyCohorts = new Map<
    string,
    { quotes: number; booked: number; unbookedQuotes: number; value: number }
  >()
  for (const sessionId of qualifiedQuoteSessions) {
    const date = quoteDateBySession.get(sessionId)
    if (!date) continue
    const cohort = dailyCohorts.get(date) ?? {
      quotes: 0,
      booked: 0,
      unbookedQuotes: 0,
      value: 0,
    }
    cohort.quotes++
    if (stepsBySession.get(sessionId)?.has('booked')) {
      cohort.booked++
    } else {
      cohort.unbookedQuotes++
      cohort.value += bestQuoteBySession.get(sessionId) ?? 0
    }
    dailyCohorts.set(date, cohort)
  }

  const cohortDates = [...dailyCohorts.keys()].sort()
  const trendStart = options?.sinceDate ?? cohortDates[0] ?? null
  const trendEnd =
    options?.endDate ?? cohortDates[cohortDates.length - 1] ?? trendStart
  const trend: FunnelTrendPoint[] = []
  if (trendStart && trendEnd) {
    const cursor = new Date(`${trendStart}T12:00:00Z`)
    // Skip the first six partial points so every plotted value represents a
    // complete seven-day window.
    cursor.setUTCDate(cursor.getUTCDate() + TREND_WINDOW_DAYS - 1)
    const end = new Date(`${trendEnd}T12:00:00Z`)
    for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      let quotes = 0
      let booked = 0
      let unbookedQuotes = 0
      let value = 0
      for (let offset = TREND_WINDOW_DAYS - 1; offset >= 0; offset--) {
        const day = new Date(cursor)
        day.setUTCDate(day.getUTCDate() - offset)
        const cohort = dailyCohorts.get(day.toISOString().slice(0, 10))
        if (!cohort) continue
        quotes += cohort.quotes
        booked += cohort.booked
        unbookedQuotes += cohort.unbookedQuotes
        value += cohort.value
      }
      trend.push({
        date: cursor.toISOString().slice(0, 10),
        quotes,
        booked,
        unbookedQuotes,
        quoteToBookRate: quotes > 0 ? round1((booked / quotes) * 100) : null,
        unbookedQuoteValue: round2(value),
      })
    }
  }

  return {
    sinceDate: options?.sinceDate ?? null,
    windowDays: options?.windowDays ?? null,
    steps: stepSummaries,
    visitorSessions,
    quoteSessions,
    bookedSessions,
    quoteToBookRate:
      quoteSessions > 0 ? round1((bookedSessions / quoteSessions) * 100) : 0,
    visitToQuoteRate:
      visitorSessions > 0 ? round1((quoteSessions / visitorSessions) * 100) : 0,
    visitToBookRate:
      visitorSessions > 0
        ? round1((bookedSessions / visitorSessions) * 100)
        : 0,
    abandonedQuotes,
    abandonedQuoteValue: round2(abandonedQuoteValue),
    bookedQuoteValue: round2(bookedQuoteValue),
    avgAbandonedQuote:
      abandonedQuotes > 0 ? round2(abandonedQuoteValue / abandonedQuotes) : 0,
    biggestDropStep,
    biggestDropCount,
    topAbandonedReferrers,
    trend,
  }
}

export async function loadBookingFunnel(
  supabase: SupabaseClient,
  options?: { windowDays?: number },
): Promise<BookingFunnelSummary> {
  const windowDays = options?.windowDays ?? 90
  const since = new Date(Date.now() - windowDays * 86400000).toISOString()

  const rows: EventRow[] = []
  const pageSize = 1000

  // Supabase's Data API caps each response at the project's configured row
  // limit, even when .limit(20000) is requested. Page explicitly so a busy
  // 90-day window cannot silently turn into a partial funnel.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('booking_funnel_events')
      .select('session_id, step, quote_total, referrer, created_at')
      .gte('created_at', since)
      // Owner test bookings fire real `booked` events with real dollar values.
      .eq('is_test', false)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw error
    rows.push(...((data || []) as EventRow[]))
    if (!data || data.length < pageSize) break
  }

  return summarizeFunnel(rows, {
    sinceDate: since.slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    windowDays,
  })
}
