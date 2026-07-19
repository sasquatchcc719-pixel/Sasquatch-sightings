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
  /** % of sessions that built a quote and also reached this step. */
  pctOfQuotes: number
  /** Sessions lost between the previous step and this one. */
  droppedFromPrevious: number
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
  options?: { sinceDate?: string | null; windowDays?: number | null },
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

  const counts = new Map<FunnelStep, number>()
  for (const step of FUNNEL_STEPS) counts.set(step, 0)
  for (const steps of stepsBySession.values()) {
    for (const step of FUNNEL_STEPS) {
      if (steps.has(step)) counts.set(step, (counts.get(step) ?? 0) + 1)
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
      pctOfQuotes:
        quoteSessions > 0 ? round1((sessions / quoteSessions) * 100) : 0,
      droppedFromPrevious: dropped,
    }
  })

  let abandonedQuoteValue = 0
  let bookedQuoteValue = 0
  let abandonedQuotes = 0
  const abandonedReferrers = new Map<string, number>()

  for (const [sessionId, steps] of stepsBySession) {
    if (!steps.has('quote_started')) continue
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
  }
}

export async function loadBookingFunnel(
  supabase: SupabaseClient,
  options?: { windowDays?: number },
): Promise<BookingFunnelSummary> {
  const windowDays = options?.windowDays ?? 90
  const since = new Date(Date.now() - windowDays * 86400000).toISOString()

  const { data, error } = await supabase
    .from('booking_funnel_events')
    .select('session_id, step, quote_total, referrer, created_at')
    .gte('created_at', since)
    .limit(20000)

  if (error) throw error

  return summarizeFunnel((data || []) as EventRow[], {
    sinceDate: since.slice(0, 10),
    windowDays,
  })
}
