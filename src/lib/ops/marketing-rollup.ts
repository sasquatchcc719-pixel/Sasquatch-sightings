import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSearchConsoleClient,
  GSC_SIGHTINGS_PROPERTY,
  GSC_WWW_PROPERTY,
  queryPageRows,
  type GscPageRow,
} from '@/lib/gsc'
import { normalizeTown, townLabel, TOWNS, type TownSlug } from '@/lib/geo/towns'

export const BUSINESS_WIDE = 'business-wide' as const
export const UNKNOWN_TOWN = 'unknown' as const
export type RollupTownSlug =
  | TownSlug
  | typeof BUSINESS_WIDE
  | typeof UNKNOWN_TOWN

const MOUNTAIN_TIME = 'America/Denver'
const GSC_LAG_DAYS = 3
const MAPS_NOT_FOUND_RANK = 21

export type WeekWindow = { start: string; end: string }

export type RollupEvent = {
  id: string
  occurred_at: string
  category: string
  title: string
  detail: string | null
}

export type MarketingWeeklyRollupRow = {
  week_start: string
  week_end: string
  town_slug: RollupTownSlug
  spend: number
  rank_best: number | null
  rank_median: number | null
  rank_points: number
  rank_found: number
  gsc_impressions: number
  gsc_clicks: number
  gsc_data_through: string | null
  quote_sessions: number
  residential_jobs: number
  residential_revenue: number
  commercial_jobs: number
  commercial_revenue: number
  review_delta: number | null
  events: RollupEvent[]
  built_at: string
}

export function coerceMarketingWeeklyRollupRow(
  row: Record<string, unknown>,
): MarketingWeeklyRollupRow {
  return {
    ...(row as Omit<MarketingWeeklyRollupRow, 'spend'>),
    town_slug: String(row.town_slug) as RollupTownSlug,
    spend: Number(row.spend || 0),
    rank_best: row.rank_best === null ? null : Number(row.rank_best),
    rank_median: row.rank_median === null ? null : Number(row.rank_median),
    rank_points: Number(row.rank_points || 0),
    rank_found: Number(row.rank_found || 0),
    gsc_impressions: Number(row.gsc_impressions || 0),
    gsc_clicks: Number(row.gsc_clicks || 0),
    quote_sessions: Number(row.quote_sessions || 0),
    residential_jobs: Number(row.residential_jobs || 0),
    residential_revenue: Number(row.residential_revenue || 0),
    commercial_jobs: Number(row.commercial_jobs || 0),
    commercial_revenue: Number(row.commercial_revenue || 0),
    review_delta: row.review_delta === null ? null : Number(row.review_delta),
    events: Array.isArray(row.events) ? (row.events as RollupEvent[]) : [],
  }
}

export type CampaignCostInput = {
  id: string
  source_type: string
  source_id: string | null
  amount: number
  occurred_on: string | null
  town_slugs: string[]
}

export type RankPointInput = {
  occurred_at: string
  lat: number
  lng: number
  rank: number | null
  found?: boolean
}

export type QuoteSessionInput = {
  session_id: string
  quote_created_at: string
  is_test: boolean
  appointment_town_slug: string | null
  landing_paths: string[]
}

export type AppointmentInput = {
  appointment_date: string
  status: string
  kind: string
  quoted_total: number
  town_slug: string | null
  business_name: string | null
  batch_billing_customer_id: string | null
  is_internal: boolean
}

export type ReviewSnapshotInput = {
  captured_on: string
  total_on_google: number | null
}

export type MarketingEventInput = RollupEvent & { town_slugs: string[] }

export function mountainDateKey(value: Date | string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TIME,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function addDateDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function weekForDateKey(dateKey: string): WeekWindow {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  const start = addDateDays(dateKey, -daysSinceMonday)
  return { start, end: addDateDays(start, 6) }
}

export function weeksThroughCurrent(
  count: number,
  now = new Date(),
): WeekWindow[] {
  const current = weekForDateKey(mountainDateKey(now))
  return Array.from({ length: count }, (_, index) => {
    const start = addDateDays(current.start, index * -7)
    return { start, end: addDateDays(start, 6) }
  })
}

export function completedWeeks(count: number, now = new Date()): WeekWindow[] {
  const current = weekForDateKey(mountainDateKey(now))
  return Array.from({ length: count }, (_, index) => {
    const start = addDateDays(current.start, (index + 1) * -7)
    return { start, end: addDateDays(start, 6) }
  })
}

function dateInWindow(dateKey: string, window: WeekWindow): boolean {
  return dateKey >= window.start && dateKey <= window.end
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : round2((sorted[middle - 1] + sorted[middle]) / 2)
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function nearestTownSlug(lat: number, lng: number): TownSlug {
  let closest = TOWNS[0]
  let closestDistance = Number.POSITIVE_INFINITY
  for (const town of TOWNS) {
    const distance = distanceMiles(lat, lng, town.lat, town.lng)
    if (distance < closestDistance) {
      closest = town
      closestDistance = distance
    }
  }
  return closest.slug
}

function canonicalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function inferTownFromPath(
  value: string | null | undefined,
): TownSlug | null {
  if (!value) return null
  let path = value
  try {
    path = new URL(value, 'https://www.sasquatchcarpet.com').pathname
  } catch {
    // Keep the raw path; malformed analytics values should not break a rollup.
  }
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep the encoded value if it is malformed.
  }

  const segments = path.split('/').filter(Boolean).reverse()
  for (const segment of segments) {
    const exact = normalizeTown(segment.replace(/-/g, ' '))
    if (exact) return exact
  }

  const text = ` ${canonicalText(path)} `
  const candidates = TOWNS.flatMap((town) => [
    town.name,
    town.slug,
    ...town.aliases,
  ]).sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    const phrase = canonicalText(candidate)
    if (phrase && text.includes(` ${phrase} `)) {
      return normalizeTown(phrase)
    }
  }
  return null
}

function emptyRow(
  window: WeekWindow,
  townSlug: RollupTownSlug,
  builtAt: string,
  gscDataThrough: string | null,
): MarketingWeeklyRollupRow {
  return {
    week_start: window.start,
    week_end: window.end,
    town_slug: townSlug,
    spend: 0,
    rank_best: null,
    rank_median: null,
    rank_points: 0,
    rank_found: 0,
    gsc_impressions: 0,
    gsc_clicks: 0,
    gsc_data_through: gscDataThrough,
    quote_sessions: 0,
    residential_jobs: 0,
    residential_revenue: 0,
    commercial_jobs: 0,
    commercial_revenue: 0,
    review_delta: null,
    events: [],
    built_at: builtAt,
  }
}

function normalizeRollupTown(value: string | null): RollupTownSlug {
  return normalizeTown(value) ?? UNKNOWN_TOWN
}

function allocateCents(totalCents: number, towns: RollupTownSlug[]) {
  const base = Math.floor(totalCents / towns.length)
  let remainder = totalCents - base * towns.length
  return towns.map((town_slug) => {
    const cents = base + (remainder-- > 0 ? 1 : 0)
    return { town_slug, amount: cents / 100 }
  })
}

export function buildWeeklyRollup(input: {
  window: WeekWindow
  campaignCosts: CampaignCostInput[]
  rankPoints: RankPointInput[]
  gscRows: GscPageRow[]
  gscDataThrough: string | null
  quoteSessions: QuoteSessionInput[]
  appointments: AppointmentInput[]
  reviewSnapshots: ReviewSnapshotInput[]
  events: MarketingEventInput[]
  builtAt?: string
}): MarketingWeeklyRollupRow[] {
  const builtAt = input.builtAt ?? new Date().toISOString()
  const townOrder: RollupTownSlug[] = [
    BUSINESS_WIDE,
    ...TOWNS.map((town) => town.slug),
    UNKNOWN_TOWN,
  ]
  const rows = new Map(
    townOrder.map((town) => [
      town,
      emptyRow(input.window, town, builtAt, input.gscDataThrough),
    ]),
  )
  const rowFor = (town: RollupTownSlug) => rows.get(town)!

  // A QuickBooks line can be linked to two accidentally duplicated campaigns.
  // Deduplicate the underlying source, not the link row, so total spend still
  // reconciles to the books.
  const uniqueCosts = new Map<
    string,
    CampaignCostInput & {
      scopedTowns: Set<RollupTownSlug>
      businessWide: boolean
    }
  >()
  for (const cost of input.campaignCosts) {
    if (!cost.occurred_on || !dateInWindow(cost.occurred_on, input.window))
      continue
    const key = cost.source_id
      ? `${cost.source_type}:${cost.source_id}`
      : `row:${cost.id}`
    const scoped = cost.town_slugs.map((town) => normalizeRollupTown(town))
    const existing = uniqueCosts.get(key)
    if (existing) {
      if (
        Math.abs(existing.amount - cost.amount) > 0.009 ||
        existing.occurred_on !== cost.occurred_on
      ) {
        throw new Error(`Conflicting campaign cost links for ${key}`)
      }
      if (!scoped.length) existing.businessWide = true
      scoped.forEach((town) => existing.scopedTowns.add(town))
    } else {
      uniqueCosts.set(key, {
        ...cost,
        scopedTowns: new Set(scoped),
        businessWide: scoped.length === 0,
      })
    }
  }
  for (const cost of uniqueCosts.values()) {
    const towns = cost.businessWide
      ? [BUSINESS_WIDE]
      : [...cost.scopedTowns].sort()
    for (const allocation of allocateCents(
      Math.round(cost.amount * 100),
      towns,
    )) {
      const row = rowFor(allocation.town_slug)
      row.spend = round2(row.spend + allocation.amount)
    }
  }

  const rankValues = new Map<RollupTownSlug, number[]>()
  for (const point of input.rankPoints) {
    if (!dateInWindow(mountainDateKey(point.occurred_at), input.window))
      continue
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue
    const town = nearestTownSlug(point.lat, point.lng)
    const validRank =
      point.found !== false &&
      point.rank !== null &&
      point.rank >= 1 &&
      point.rank <= 20
        ? point.rank
        : null
    const row = rowFor(town)
    row.rank_points++
    if (validRank !== null) row.rank_found++
    const list = rankValues.get(town) ?? []
    list.push(validRank ?? MAPS_NOT_FOUND_RANK)
    rankValues.set(town, list)
  }
  for (const [town, values] of rankValues) {
    const row = rowFor(town)
    const found = values.filter((rank) => rank <= 20)
    row.rank_best = found.length ? Math.min(...found) : null
    row.rank_median = median(values)
  }

  for (const gsc of input.gscRows) {
    const town = inferTownFromPath(gsc.page) ?? BUSINESS_WIDE
    const row = rowFor(town)
    row.gsc_impressions += Math.max(0, Math.round(gsc.impressions))
    row.gsc_clicks += Math.max(0, Math.round(gsc.clicks))
  }

  const seenQuotes = new Set<string>()
  for (const quote of input.quoteSessions) {
    if (
      quote.is_test ||
      seenQuotes.has(quote.session_id) ||
      !dateInWindow(mountainDateKey(quote.quote_created_at), input.window)
    ) {
      continue
    }
    seenQuotes.add(quote.session_id)
    const appointmentTown = normalizeTown(quote.appointment_town_slug)
    const landingTown = quote.landing_paths
      .map(inferTownFromPath)
      .find((town): town is TownSlug => Boolean(town))
    rowFor(appointmentTown ?? landingTown ?? BUSINESS_WIDE).quote_sessions++
  }

  for (const appointment of input.appointments) {
    if (
      !dateInWindow(appointment.appointment_date, input.window) ||
      appointment.status !== 'completed' ||
      appointment.kind === 'estimate' ||
      appointment.quoted_total <= 1 ||
      appointment.is_internal
    ) {
      continue
    }
    const row = rowFor(normalizeRollupTown(appointment.town_slug))
    const commercial = Boolean(
      appointment.business_name?.trim() ||
      appointment.batch_billing_customer_id,
    )
    if (commercial) {
      row.commercial_jobs++
      row.commercial_revenue = round2(
        row.commercial_revenue + appointment.quoted_total,
      )
    } else {
      row.residential_jobs++
      row.residential_revenue = round2(
        row.residential_revenue + appointment.quoted_total,
      )
    }
  }

  const reviewRows = input.reviewSnapshots
    .filter((row) => row.total_on_google !== null)
    .sort((a, b) => a.captured_on.localeCompare(b.captured_on))
  const baseline = [...reviewRows]
    .reverse()
    .find((row) => row.captured_on < input.window.start)
  const lastInWeek = [...reviewRows]
    .reverse()
    .find((row) => dateInWindow(row.captured_on, input.window))
  if (baseline && lastInWeek) {
    rowFor(BUSINESS_WIDE).review_delta =
      Number(lastInWeek.total_on_google) - Number(baseline.total_on_google)
  }

  for (const event of input.events) {
    if (!dateInWindow(mountainDateKey(event.occurred_at), input.window))
      continue
    const scopedTowns: RollupTownSlug[] = event.town_slugs.length
      ? [...new Set(event.town_slugs.map((town) => normalizeRollupTown(town)))]
      : [BUSINESS_WIDE]
    for (const town of scopedTowns) {
      rowFor(town).events.push({
        id: event.id,
        occurred_at: event.occurred_at,
        category: event.category,
        title: event.title,
        detail: event.detail,
      })
    }
  }

  return townOrder.map((town) => rows.get(town)!)
}

type QueryError = { message: string }
type PageResult<T> = { data: T[] | null; error: QueryError | null }

async function loadPages<T>(
  load: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const pageSize = 1000
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await load(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

type RawFunnelEvent = {
  session_id: string
  step: string
  created_at: string
  appointment_id: string | null
  landing_path: string | null
  is_test: boolean
}

export async function refreshMarketingWeeklyRollup(
  supabase: SupabaseClient,
  options: {
    windows: WeekWindow[]
    now?: Date
    gscRowsForWindow?: (
      window: WeekWindow,
      dataThrough: string,
    ) => Promise<GscPageRow[]>
  },
): Promise<{ rows: MarketingWeeklyRollupRow[]; builtAt: string }> {
  if (!options.windows.length)
    return { rows: [], builtAt: new Date().toISOString() }

  const windows = [...options.windows].sort((a, b) =>
    a.start.localeCompare(b.start),
  )
  const start = windows[0].start
  const end = windows[windows.length - 1].end
  const broadTimestampStart = `${addDateDays(start, -1)}T00:00:00.000Z`
  const broadTimestampEnd = `${addDateDays(end, 2)}T23:59:59.999Z`

  const [
    campaigns,
    rawCosts,
    radarScans,
    falconScans,
    funnelEvents,
    jobs,
    reviews,
    events,
  ] = await Promise.all([
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('marketing_campaigns')
        .select('id, town_slugs')
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('marketing_campaign_costs')
        .select('id, campaign_id, source_type, source_id, amount, occurred_on')
        .gte('occurred_on', start)
        .lte('occurred_on', end)
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('radar_grid_scans')
        .select('id, completed_at')
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .gte('completed_at', broadTimestampStart)
        .lte('completed_at', broadTimestampEnd)
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('local_falcon_scans')
        .select('id, scanned_at')
        .gte('scanned_at', broadTimestampStart)
        .lte('scanned_at', broadTimestampEnd)
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<RawFunnelEvent>(async (from, to) => {
      const result = await supabase
        .from('booking_funnel_events')
        .select(
          'session_id, step, created_at, appointment_id, landing_path, is_test',
        )
        .eq('is_test', false)
        .gte('created_at', broadTimestampStart)
        .range(from, to)
      return result as PageResult<RawFunnelEvent>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('ops_appointments')
        .select(
          'id, appointment_date, status, kind, quoted_total, service_address_id, customer_id, batch_billing_customer_id',
        )
        .gte('appointment_date', start)
        .lte('appointment_date', end)
        .eq('status', 'completed')
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('gbp_review_counts')
        .select('captured_on, total_on_google')
        .lte('captured_on', end)
        .order('captured_on', { ascending: false })
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
    loadPages<Record<string, unknown>>(async (from, to) => {
      const result = await supabase
        .from('marketing_events')
        .select('id, occurred_at, category, title, detail, town_slugs')
        .gte('occurred_at', broadTimestampStart)
        .lte('occurred_at', broadTimestampEnd)
        .range(from, to)
      return result as PageResult<Record<string, unknown>>
    }),
  ])

  const campaignTowns = new Map(
    campaigns.map((campaign) => [
      String(campaign.id),
      (campaign.town_slugs as string[] | null) ?? [],
    ]),
  )
  const campaignCosts: CampaignCostInput[] = rawCosts.map((cost) => ({
    id: String(cost.id),
    source_type: String(cost.source_type),
    source_id: cost.source_id ? String(cost.source_id) : null,
    amount: Number(cost.amount || 0),
    occurred_on: cost.occurred_on ? String(cost.occurred_on) : null,
    town_slugs: campaignTowns.get(String(cost.campaign_id)) ?? [],
  }))

  const radarIds = radarScans.map((scan) => String(scan.id))
  const falconIds = falconScans.map((scan) => String(scan.id))
  const [radarPoints, falconPoints] = await Promise.all([
    radarIds.length
      ? loadPages<Record<string, unknown>>(async (from, to) => {
          const result = await supabase
            .from('radar_grid_points')
            .select('scan_id, lat, lng, my_rank')
            .in('scan_id', radarIds)
            .range(from, to)
          return result as PageResult<Record<string, unknown>>
        })
      : [],
    falconIds.length
      ? loadPages<Record<string, unknown>>(async (from, to) => {
          const result = await supabase
            .from('local_falcon_points')
            .select('scan_id, lat, lng, found, rank')
            .in('scan_id', falconIds)
            .range(from, to)
          return result as PageResult<Record<string, unknown>>
        })
      : [],
  ])
  const radarTimes = new Map(
    radarScans.map((scan) => [String(scan.id), String(scan.completed_at)]),
  )
  const falconTimes = new Map(
    falconScans.map((scan) => [String(scan.id), String(scan.scanned_at)]),
  )
  const rankPoints: RankPointInput[] = [
    ...radarPoints.map((point) => ({
      occurred_at: radarTimes.get(String(point.scan_id))!,
      lat: Number(point.lat),
      lng: Number(point.lng),
      rank: point.my_rank === null ? null : Number(point.my_rank),
    })),
    ...falconPoints.map((point) => ({
      occurred_at: falconTimes.get(String(point.scan_id))!,
      lat: Number(point.lat),
      lng: Number(point.lng),
      rank: point.rank === null ? null : Number(point.rank),
      found: Boolean(point.found),
    })),
  ]

  const sessions = new Map<
    string,
    {
      quote_created_at: string | null
      appointment_id: string | null
      paths: string[]
    }
  >()
  for (const event of funnelEvents) {
    const session = sessions.get(event.session_id) ?? {
      quote_created_at: null,
      appointment_id: null,
      paths: [],
    }
    if (event.step === 'quote_started')
      session.quote_created_at = event.created_at
    if (event.appointment_id) session.appointment_id = event.appointment_id
    if (event.landing_path) session.paths.push(event.landing_path)
    sessions.set(event.session_id, session)
  }
  const funnelAppointmentIds = [
    ...new Set(
      [...sessions.values()]
        .map((session) => session.appointment_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const funnelAppointments = funnelAppointmentIds.length
    ? await loadPages<Record<string, unknown>>(async (from, to) => {
        const result = await supabase
          .from('ops_appointments')
          .select('id, service_address_id')
          .in('id', funnelAppointmentIds)
          .range(from, to)
        return result as PageResult<Record<string, unknown>>
      })
    : []

  const addressIds = [
    ...new Set(
      [...jobs, ...funnelAppointments]
        .map((appointment) => appointment.service_address_id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id)),
    ),
  ]
  const customerIds = [
    ...new Set(
      jobs
        .map((appointment) => appointment.customer_id)
        .filter((id): id is string => typeof id === 'string' && Boolean(id)),
    ),
  ]
  const [addresses, customers] = await Promise.all([
    addressIds.length
      ? loadPages<Record<string, unknown>>(async (from, to) => {
          const result = await supabase
            .from('ops_service_addresses')
            .select('id, town_slug')
            .in('id', addressIds)
            .range(from, to)
          return result as PageResult<Record<string, unknown>>
        })
      : [],
    customerIds.length
      ? loadPages<Record<string, unknown>>(async (from, to) => {
          const result = await supabase
            .from('ops_customers')
            .select('id, business_name, is_internal')
            .in('id', customerIds)
            .range(from, to)
          return result as PageResult<Record<string, unknown>>
        })
      : [],
  ])
  const townsByAddress = new Map(
    addresses.map((address) => [
      String(address.id),
      address.town_slug ? String(address.town_slug) : null,
    ]),
  )
  const customersById = new Map(
    customers.map((customer) => [String(customer.id), customer]),
  )
  const funnelTownByAppointment = new Map(
    funnelAppointments.map((appointment) => [
      String(appointment.id),
      townsByAddress.get(String(appointment.service_address_id)) ?? null,
    ]),
  )
  const quoteSessions: QuoteSessionInput[] = [...sessions.entries()]
    .filter(([, session]) => session.quote_created_at)
    .map(([sessionId, session]) => ({
      session_id: sessionId,
      quote_created_at: session.quote_created_at!,
      is_test: false,
      appointment_town_slug: session.appointment_id
        ? (funnelTownByAppointment.get(session.appointment_id) ?? null)
        : null,
      landing_paths: session.paths,
    }))
  const appointmentInputs: AppointmentInput[] = jobs.map((appointment) => {
    const customer = customersById.get(String(appointment.customer_id))
    return {
      appointment_date: String(appointment.appointment_date),
      status: String(appointment.status),
      kind: String(appointment.kind),
      quoted_total: Number(appointment.quoted_total || 0),
      town_slug:
        townsByAddress.get(String(appointment.service_address_id)) ?? null,
      business_name: customer?.business_name
        ? String(customer.business_name)
        : null,
      batch_billing_customer_id: appointment.batch_billing_customer_id
        ? String(appointment.batch_billing_customer_id)
        : null,
      is_internal: Boolean(customer?.is_internal),
    }
  })

  const now = options.now ?? new Date()
  const latestGscDate = addDateDays(mountainDateKey(now), -GSC_LAG_DAYS)
  const sc = options.gscRowsForWindow ? null : getSearchConsoleClient()
  const gscLoader =
    options.gscRowsForWindow ??
    (async (window: WeekWindow, dataThrough: string) => {
      const [www, sightings] = await Promise.all([
        queryPageRows(sc!, GSC_WWW_PROPERTY, window.start, dataThrough),
        queryPageRows(sc!, GSC_SIGHTINGS_PROPERTY, window.start, dataThrough),
      ])
      return [...www, ...sightings]
    })

  const builtAt = new Date().toISOString()
  const rollupRows: MarketingWeeklyRollupRow[] = []
  for (const window of windows) {
    const gscDataThrough =
      latestGscDate < window.start
        ? null
        : latestGscDate < window.end
          ? latestGscDate
          : window.end
    const gscRows = gscDataThrough
      ? await gscLoader(window, gscDataThrough)
      : []
    rollupRows.push(
      ...buildWeeklyRollup({
        window,
        campaignCosts,
        rankPoints,
        gscRows,
        gscDataThrough,
        quoteSessions,
        appointments: appointmentInputs,
        reviewSnapshots: reviews.map((row) => ({
          captured_on: String(row.captured_on),
          total_on_google:
            row.total_on_google === null ? null : Number(row.total_on_google),
        })),
        events: events.map((event) => ({
          id: String(event.id),
          occurred_at: String(event.occurred_at),
          category: String(event.category),
          title: String(event.title),
          detail: event.detail ? String(event.detail) : null,
          town_slugs: (event.town_slugs as string[] | null) ?? [],
        })),
        builtAt,
      }),
    )
  }

  const { error } = await supabase
    .from('marketing_weekly_rollup')
    .upsert(rollupRows, { onConflict: 'week_start,town_slug' })
  if (error) throw new Error(error.message)

  return { rows: rollupRows, builtAt }
}

function money(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export function buildMarketingRollupDigest(
  rows: MarketingWeeklyRollupRow[],
): string {
  if (!rows.length)
    return 'Weekly Marketing Rollup\n\nNo rollup rows were built.'
  const weekStart = rows[0].week_start
  const weekEnd = rows[0].week_end
  const total = rows.reduce(
    (sum, row) => ({
      spend: sum.spend + row.spend,
      residentialJobs: sum.residentialJobs + row.residential_jobs,
      residentialRevenue: sum.residentialRevenue + row.residential_revenue,
      commercialJobs: sum.commercialJobs + row.commercial_jobs,
      commercialRevenue: sum.commercialRevenue + row.commercial_revenue,
      impressions: sum.impressions + row.gsc_impressions,
      clicks: sum.clicks + row.gsc_clicks,
      quotes: sum.quotes + row.quote_sessions,
    }),
    {
      spend: 0,
      residentialJobs: 0,
      residentialRevenue: 0,
      commercialJobs: 0,
      commercialRevenue: 0,
      impressions: 0,
      clicks: 0,
      quotes: 0,
    },
  )
  const wide = rows.find((row) => row.town_slug === BUSINESS_WIDE)
  const gscThrough = rows.find((row) => row.gsc_data_through)?.gsc_data_through
  const lines = [
    `Weekly Marketing Rollup · ${weekStart} to ${weekEnd}`,
    '',
    `Spend ${money(total.spend)} · Residential ${total.residentialJobs} jobs / ${money(total.residentialRevenue)}`,
    `Demand ${total.impressions.toLocaleString()} impressions / ${total.clicks} clicks / ${total.quotes} quotes${gscThrough ? ` · GSC through ${gscThrough}` : ''}`,
  ]
  if (total.spend > 0) {
    lines.push(
      `Revenue / tracked spend ${round2(total.residentialRevenue / total.spend).toFixed(2)}x · ${money(total.spend / Math.max(total.residentialJobs, 1))}/residential job (directional, not attributed ROAS)`,
    )
  }
  if (total.commercialJobs > 0) {
    lines.push(
      `Commercial (separate) ${total.commercialJobs} jobs / ${money(total.commercialRevenue)}`,
    )
  }
  if (wide?.review_delta !== null && wide?.review_delta !== undefined) {
    const sign = wide.review_delta > 0 ? '+' : ''
    lines.push(`Google reviews ${sign}${wide.review_delta}`)
  }

  const townRows = rows
    .filter(
      (row) =>
        ![BUSINESS_WIDE, UNKNOWN_TOWN].includes(
          row.town_slug as typeof BUSINESS_WIDE,
        ) &&
        (row.residential_jobs > 0 ||
          row.commercial_jobs > 0 ||
          row.rank_points > 0 ||
          row.gsc_impressions > 0 ||
          row.quote_sessions > 0 ||
          row.spend > 0),
    )
    .sort((a, b) => b.residential_revenue - a.residential_revenue)
  if (townRows.length) lines.push('', 'By town:')
  for (const row of townRows) {
    const rank = row.rank_points
      ? ` · Maps best ${row.rank_best ?? 'out'}, med ${row.rank_median === 21 ? 'out' : row.rank_median}, ${row.rank_found}/${row.rank_points} found`
      : ''
    const demand =
      row.gsc_impressions || row.gsc_clicks || row.quote_sessions
        ? ` · Demand ${row.gsc_impressions} impr / ${row.gsc_clicks} clicks / ${row.quote_sessions} quotes`
        : ''
    lines.push(
      `${townLabel(row.town_slug)}: ${row.residential_jobs} resi / ${money(row.residential_revenue)}${row.commercial_jobs ? ` · ${row.commercial_jobs} comm / ${money(row.commercial_revenue)}` : ''}${demand}${rank}`,
    )
  }

  const uniqueEvents = new Map<string, RollupEvent>()
  rows
    .flatMap((row) => row.events)
    .forEach((event) => uniqueEvents.set(event.id, event))
  if (uniqueEvents.size) {
    lines.push('', 'Events:')
    ;[...uniqueEvents.values()].slice(0, 5).forEach((event) => {
      lines.push(`- ${event.title}`)
    })
  }

  return lines.join('\n').slice(0, 4096)
}
