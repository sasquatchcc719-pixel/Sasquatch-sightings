import type { SupabaseClient } from '@supabase/supabase-js'
import { CANONICAL_LEAD_SOURCE_OPTIONS } from '@/lib/lead-sources'
import { TOWNS } from '@/lib/geo/towns'
import { completedWeeks, type Period } from './reporting'
import type { BriefSection } from './briefing'

type FunnelEvent = {
  id: string
  session_id: string
  step: string
  created_at: string
  appointment_id: string | null
  referrer: string | null
  is_test: boolean | null
}
type LinkedAppointment = {
  id: string
  status: string
  kind: string
  lead_source_key: string | null
  ops_customers: { is_internal: boolean | null } | null
  ops_service_addresses: {
    city: string | null
    town_slug: string | null
  } | null
}
type Counts = {
  appointments: number
  open: number
  completed: number
  cancelled: number
  other: number
}
export type BusinessOutcomes = Counts & {
  quoteSessions: number
  unlinkedQuoteSessions: number
  unresolvedQuoteSessions: number
  excludedQuoteSessions: number
  byTown: Array<Counts & { town: string }>
  recordedSources: Array<{ label: string; appointments: number }>
  googleReferrerAppointments: number
}
function serviceTown(
  address: LinkedAppointment['ops_service_addresses'],
): string {
  const canonical = (value: string | null) =>
    (value ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  for (const value of [address?.town_slug, address?.city]) {
    if (!value) continue
    const match = TOWNS.find((town) =>
      [town.slug, town.name, ...town.aliases].some(
        (name) => canonical(name) === canonical(value),
      ),
    )
    if (match) return match.name
  }
  return 'Unknown'
}
const emptyCounts = (): Counts => ({
  appointments: 0,
  open: 0,
  completed: 0,
  cancelled: 0,
  other: 0,
})
const mountainDay = (value: string | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000)
    .toISOString()
    .slice(0, 10)

export function businessPeriod(now: Date): Period {
  // Yesterday is the last complete local day, including when today is Sunday.
  return completedWeeks(shiftDay(mountainDay(now), -1)).current
}

/** Exact stored session/appointment links only. Never match contacts, infer a
 * visitor's town from a page, or turn a referrer into paid/organic attribution. */
export function summarizeBusinessOutcomes(
  events: FunnelEvent[],
  appointments: LinkedAppointment[],
  period: Period,
): BusinessOutcomes {
  const sessions = new Map<string, FunnelEvent[]>()
  for (const event of events) {
    const rows = sessions.get(event.session_id) ?? []
    rows.push(event)
    sessions.set(event.session_id, rows)
  }
  const result: BusinessOutcomes = {
    ...emptyCounts(),
    quoteSessions: 0,
    unlinkedQuoteSessions: 0,
    unresolvedQuoteSessions: 0,
    excludedQuoteSessions: 0,
    byTown: [],
    recordedSources: [],
    googleReferrerAppointments: 0,
  }
  const appointmentById = new Map(appointments.map((row) => [row.id, row]))
  const linked = new Map<
    string,
    { appointment: LinkedAppointment; google: boolean }
  >()
  for (const rows of sessions.values()) {
    const firstQuote = rows
      .filter((row) => row.step === 'quote_started')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    if (!firstQuote) continue
    const day = mountainDay(firstQuote.created_at)
    if (day < period.start || day > period.end) continue
    const bookingRows = rows.filter(
      (row) => row.step === 'booked' && row.appointment_id,
    )
    const ids = [...new Set(bookingRows.map((row) => row.appointment_id!))]
    const linkedRows = ids.map((id) => appointmentById.get(id))
    // Internal/test evidence excludes the whole session, not just its last event.
    if (
      rows.some((row) => row.is_test) ||
      linkedRows.some((row) => row?.ops_customers?.is_internal)
    ) {
      result.excludedQuoteSessions++
      continue
    }
    result.quoteSessions++
    if (!ids.length) {
      if (rows.some((row) => row.step === 'booked'))
        result.unresolvedQuoteSessions++
      else result.unlinkedQuoteSessions++
      continue
    }
    const appointment = linkedRows[0]
    if (
      ids.length !== 1 ||
      bookingRows.some((row) => row.created_at < firstQuote.created_at) ||
      !appointment ||
      appointment.kind !== 'service' ||
      appointment.ops_customers?.is_internal !== false
    ) {
      result.unresolvedQuoteSessions++
      continue
    }
    const google = rows.some((row) => {
      try {
        return /^(www\.)?google\.[a-z.]+$/.test(
          new URL(row.referrer ?? '').hostname,
        )
      } catch {
        return false
      }
    })
    linked.set(appointment.id, {
      appointment,
      google: google || Boolean(linked.get(appointment.id)?.google),
    })
  }
  const towns = new Map<string, Counts>()
  const sources = new Map<string, number>()
  for (const { appointment, google } of linked.values()) {
    const address = appointment.ops_service_addresses
    const town = serviceTown(address)
    const counts = towns.get(town) ?? emptyCounts()
    const status =
      appointment.status === 'completed'
        ? 'completed'
        : appointment.status === 'cancelled'
          ? 'cancelled'
          : ['booked', 'confirmed', 'on_my_way', 'in_progress'].includes(
                appointment.status,
              )
            ? 'open'
            : 'other'
    for (const target of [result, counts]) {
      target.appointments++
      target[status]++
    }
    towns.set(town, counts)
    const label =
      CANONICAL_LEAD_SOURCE_OPTIONS.find(
        (option) => option.source_key === appointment.lead_source_key,
      )?.internal_label ?? 'Unknown / unrecognized'
    sources.set(label, (sources.get(label) ?? 0) + 1)
    if (google) result.googleReferrerAppointments++
  }
  result.byTown = [...towns]
    .map(([town, counts]) => ({ town, ...counts }))
    .sort((a, b) => a.town.localeCompare(b.town))
  result.recordedSources = [...sources]
    .map(([label, appointments]) => ({ label, appointments }))
    .sort((a, b) => a.label.localeCompare(b.label))
  return result
}

const PAGE_SIZE = 500
async function pages<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await read(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Missing business evidence rows')
    rows.push(...(data as T[]))
    if (data.length < PAGE_SIZE) return rows
  }
}
const eventColumns =
  'id,session_id,step,created_at,appointment_id,referrer,is_test'
export async function loadBusinessOutcomes(
  db: SupabaseClient,
  now: Date,
): Promise<BriefSection> {
  const period = businessPeriod(now)
  // Broad UTC boundaries, then exact Mountain dates in the reducer. This covers
  // daylight-saving changes without a fixed UTC offset.
  const quotes = await pages<FunnelEvent>((from, to) =>
    db
      .from('booking_funnel_events')
      .select(eventColumns)
      .eq('step', 'quote_started')
      .gte('created_at', period.start + 'T00:00:00Z')
      .lt('created_at', shiftDay(period.end, 1) + 'T12:00:00Z')
      .order('id')
      .range(from, to),
  )
  const sessionIds = [...new Set(quotes.map((row) => row.session_id))]
  const events: FunnelEvent[] = []
  for (let offset = 0; offset < sessionIds.length; offset += 100) {
    events.push(
      ...(await pages<FunnelEvent>((from, to) =>
        db
          .from('booking_funnel_events')
          .select(eventColumns)
          .in('session_id', sessionIds.slice(offset, offset + 100))
          .lte('created_at', now.toISOString())
          .order('id')
          .range(from, to),
      )),
    )
  }
  if (quotes.some((quote) => !events.some((event) => event.id === quote.id)))
    throw new Error('Incomplete quote cohort read')
  const ids = [
    ...new Set(
      events
        .filter((row) => row.step === 'booked' && row.appointment_id)
        .map((row) => row.appointment_id!),
    ),
  ]
  const appointments: LinkedAppointment[] = []
  for (let offset = 0; offset < ids.length; offset += 100) {
    appointments.push(
      ...(await pages<LinkedAppointment>((from, to) =>
        db
          .from('ops_appointments')
          .select(
            'id,status,kind,lead_source_key,ops_customers!customer_id(is_internal),ops_service_addresses!service_address_id(city,town_slug)',
          )
          .in('id', ids.slice(offset, offset + 100))
          .order('id')
          .range(from, to),
      )),
    )
  }
  const outcomes = summarizeBusinessOutcomes(events, appointments, period)
  return {
    title: 'Business outcomes',
    state: 'partial',
    summary: `${outcomes.quoteSessions} recorded quote sessions · ${outcomes.appointments} distinct linked appointments.`,
    detail:
      'Quote sessions first recorded during this Mountain-time week. Exact recorded booking links only; sessions are not people and are not qualified SEO leads. Not all business activity or SEO revenue.',
    source:
      'booking_funnel_events.session_id → booked.appointment_id → ops_appointments.id; town from service-address town_slug or city (existing named-town aliases only, never ZIP or landing page), source from saved lead_source_key. Status is current at read time, including bookings after the quote week. Internal/test sessions excluded. Unknowns are not backfilled.',
    measuredAt: now.toISOString(),
    period,
    businessOutcomes: outcomes,
  }
}
