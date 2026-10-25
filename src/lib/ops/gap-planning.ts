import { createHash } from 'node:crypto'
import {
  calendarEventsToAppointmentWindows,
  getAvailableSlots,
  timeToMinutes,
  type AvailabilityTemplate,
  type AvailabilityOverride,
  type ExistingAppointmentWindow,
} from './availability'
import {
  addCalendarMonths,
  contactEligibility,
  normalizeFillPhone,
  normalizeHouseholdKey,
} from './tomorrow-fill-rules'

export type Gap = {
  date: string
  staff_id: string
  staff_name: string
  start_time: string
  end_time: string
  minutes: number
  internal: boolean
  version: string
  before: {
    id: string
    zip: string | null
    location?: {
      city: string
      street: string
      latitude: number | null
      longitude: number | null
    } | null
  } | null
  after: {
    id: string
    zip: string | null
    location?: {
      city: string
      street: string
      latitude: number | null
      longitude: number | null
    } | null
  } | null
  slots: Array<{ start_time: string; end_time: string }>
}
export type Calendar = {
  date: string
  staff_id: string
  staff_name: string
  open: boolean
  templates: AvailabilityTemplate[]
  overrides: AvailabilityOverride[]
  appointments: Array<
    ExistingAppointmentWindow & {
      id: string
      zip: string | null
      location?: NonNullable<Gap['before']>['location']
    }
  >
  events: Parameters<typeof calendarEventsToAppointmentWindows>[1]
}
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export function mountainDate(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}
export function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`
}

/** No DB access, implicit defaults, seeding, geocoding, or extra travel buffer. */
export function planGaps(
  calendar: Calendar,
  requiredMinutes: number,
  requestedStart?: string,
): Gap[] {
  if (!calendar.open) return []
  if (
    !Number.isInteger(requiredMinutes) ||
    requiredMinutes < 30 ||
    requiredMinutes > 240
  )
    throw new Error('Use a complete 30–240 minute job block')
  const weekday = new Date(`${calendar.date}T12:00:00Z`).getUTCDay()
  const templates = calendar.templates.filter(
    (t) => t.is_active && t.day_of_week === weekday,
  )
  if (!templates.length) return []
  const appointments = calendar.appointments
    .map((a) => ({ ...a }))
    .filter((a) =>
      [
        'booked',
        'confirmed',
        'on_my_way',
        'in_progress',
        'completed',
        'pending_approval',
      ].includes(a.status),
    )
  for (const appointment of appointments) {
    if (appointment.status === 'pending_approval') appointment.status = 'booked'
  }
  const events = calendarEventsToAppointmentWindows(
    calendar.date,
    calendar.events,
  )
  const busy = [...appointments, ...events].map((a) => [
    timeToMinutes(a.start_time),
    timeToMinutes(a.end_time),
  ])
  for (const override of calendar.overrides.filter(
    (o) => o.override_date === calendar.date && !o.is_available,
  )) {
    if (!override.start_time || !override.end_time) return []
    busy.push([
      timeToMinutes(override.start_time),
      timeToMinutes(override.end_time),
    ])
  }
  if (
    busy.some(([s, e]) => !Number.isFinite(s) || !Number.isFinite(e) || e <= s)
  )
    throw new Error(
      'Invalid busy calendar interval; availability is unverified',
    )
  const spans: Array<[number, number]> = []
  for (const template of templates) {
    let free: Array<[number, number]> = [
      [timeToMinutes(template.start_time), timeToMinutes(template.end_time)],
    ]
    for (const [s, e] of busy)
      free = free.flatMap(([a, b]) =>
        e <= a || s >= b
          ? [[a, b] as [number, number]]
          : ([
              [a, Math.max(a, s)],
              [Math.min(b, e), b],
            ].filter(([x, y]) => y > x) as Array<[number, number]>),
      )
    spans.push(...free)
  }
  // Merge overlapping template intervals; alternatives never become additive capacity.
  const merged: Array<[number, number]> = []
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  const version = digest(calendar)
  const allowed = getAvailableSlots({
    date: calendar.date,
    requiredMinutes,
    templates,
    overrides: calendar.overrides,
    appointments: [...appointments, ...events],
    maxResults: 100,
  })
  return merged
    .filter(([s, e]) => e - s >= requiredMinutes)
    .map(([s, e]) => {
      const before = appointments
        .filter((a) => timeToMinutes(a.end_time) <= s)
        .sort((a, b) => b.end_time.localeCompare(a.end_time))[0]
      const after = appointments
        .filter((a) => timeToMinutes(a.start_time) >= e)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))[0]
      const slots = allowed.filter(
        (a) =>
          timeToMinutes(a.start_time) >= s && timeToMinutes(a.end_time) <= e,
      )
      // A customer-requested alternate time is allowed by the same complete busy-window rules;
      // gap adjacency is a priority, not a restriction. Booking still requires its own preview.
      if (requestedStart) {
        const start = timeToMinutes(requestedStart)
        if (
          start >= s &&
          start + requiredMinutes <= e &&
          !slots.some((a) => timeToMinutes(a.start_time) === start)
        )
          slots.push({
            start_time: clock(start),
            end_time: clock(start + requiredMinutes),
          })
      }
      return {
        date: calendar.date,
        staff_id: calendar.staff_id,
        staff_name: calendar.staff_name,
        start_time: clock(s),
        end_time: clock(e),
        minutes: e - s,
        internal: Boolean(before && after),
        version,
        before: before
          ? {
              id: before.id,
              zip: before.zip,
              location: before.location || null,
            }
          : null,
        after: after
          ? { id: after.id, zip: after.zip, location: after.location || null }
          : null,
        slots: slots.sort((a, b) => a.start_time.localeCompare(b.start_time)),
      }
    })
    .sort(
      (a, b) =>
        Number(b.internal) - Number(a.internal) ||
        a.start_time.localeCompare(b.start_time),
    )
}

export type HistoryEvidence = {
  source: 'operations' | 'housecall_pro' | 'quickbooks'
  record_id: string
  date: string
  date_kind: 'completed_service' | 'service_snapshot' | 'accounting_transaction'
  verified: boolean
  duration_minutes: number | null
  value: number
}
export type Contact = {
  channel: string
  at: string
  direction: 'inbound' | 'outbound'
  source_id: string
  replied_at?: string | null
  booked_at?: string | null
}
export type GapCustomer = {
  id: string
  name: string
  phone: string | null
  internal: boolean
  commercial: boolean
  address: {
    id: string
    street: string
    city: string
    zip: string
    latitude: number | null
    longitude: number | null
    geocode_source: string | null
  } | null
  history: HistoryEvidence[]
  contacts: Contact[]
  conversation_id: string | null
  conversation_updated_at: string | null
  unresolved_outreach?: boolean
  business_number?: string | null
  blocked: boolean
  do_not_contact: boolean
  future_booking: boolean
  unresolved_job: boolean
  open_estimate: boolean
  consent: {
    status: string
    source: string
    consented_at: string | null
    disclosure: string | null
  } | null
}
export function rankGapCandidates(
  customers: GapCustomer[],
  gap: Gap,
  now: Date,
  settings: {
    dormancy_months: number
    customer_cooldown_days: number
    unanswered_limit: number
    rest_days: number
  },
) {
  const exclusions: Record<string, number> = {}
  const seenPhones = new Set<string>()
  const seenHomes = new Set<string>()
  const candidates = customers
    .map((customer) => {
      const history = [...customer.history].sort((a, b) =>
        b.date.localeCompare(a.date),
      )
      const last = history[0] || null
      const phone = normalizeFillPhone(customer.phone)
      const contacts = [...customer.contacts].sort((a, b) =>
        b.at.localeCompare(a.at),
      )
      const outbound = contacts.filter((c) => c.direction === 'outbound')
      const cooldown = contactEligibility({
        history: outbound.map((c) => ({
          sentAt: c.at,
          repliedAt: c.replied_at || null,
          bookedAt: c.booked_at || null,
        })),
        asOfDate: mountainDate(now),
        cooldownDays: settings.customer_cooldown_days,
        unansweredLimit: settings.unanswered_limit,
        restDays: settings.rest_days,
      })
      const reasons: string[] = []
      if (customer.internal || customer.commercial)
        reasons.push('not_residential')
      if (!phone) reasons.push('invalid_phone')
      if (customer.blocked || customer.do_not_contact)
        reasons.push('do_not_contact')
      if (
        !customer.consent ||
        customer.consent.status !== 'opted_in' ||
        !customer.consent.consented_at ||
        !customer.consent.disclosure
      )
        reasons.push(
          customer.consent?.status === 'opted_out'
            ? 'opted_out'
            : 'consent_unverified',
        )
      if (customer.unresolved_outreach) reasons.push('prior_send_uncertain')
      if (customer.future_booking) reasons.push('future_booking')
      if (customer.unresolved_job) reasons.push('unresolved_job')
      if (customer.open_estimate) reasons.push('open_estimate')
      if (!last) reasons.push('no_service_history')
      else if (
        addCalendarMonths(last.date, settings.dormancy_months) >
        mountainDate(now)
      )
        reasons.push('not_due')
      if (!customer.address) reasons.push('missing_address')
      if (!cooldown.eligible) reasons.push(cooldown.reason || 'cooldown')
      if (last?.duration_minutes && last.duration_minutes > gap.minutes)
        reasons.push('prior_block_exceeds_gap')
      if (contacts[0]?.direction === 'inbound')
        reasons.push('reply_requires_owner_review')
      const routeZips = [gap.before?.zip, gap.after?.zip].filter(Boolean)
      const routeFit =
        customer.address && routeZips.includes(customer.address.zip)
          ? 'neighbor_zip'
          : 'location_review_required'
      const point =
        customer.address &&
        customer.address.geocode_source &&
        verifiedGapGeocodeSource(customer.address.geocode_source)
          ? customer.address
          : null
      const routeDetour =
        point && gap.before?.location && gap.after?.location
          ? detourMiles(gap.before.location, point, gap.after.location)
          : null
      return {
        customer_id: customer.id,
        name: customer.name,
        phone,
        address: customer.address,
        conversation_id: customer.conversation_id,
        business_number: customer.business_number || null,
        conversation_updated_at: customer.conversation_updated_at,
        last_service: last,
        history,
        contacts: contacts.slice(0, 20),
        route_fit: routeFit,
        route_detour_miles: routeDetour,
        route_evidence:
          routeDetour === null
            ? 'drive_route_unverified'
            : 'straight_line_detour_only_drive_time_unverified',
        expected_minutes: last?.duration_minutes || null,
        duration_confirmed: false as const,
        consent: customer.consent,
        exclusions: reasons,
        lifetime_value: history.reduce((n, h) => n + h.value, 0),
      }
    })
    .sort(
      (a, b) =>
        (a.last_service?.date || '9999').localeCompare(
          b.last_service?.date || '9999',
        ) ||
        Number(b.route_fit === 'neighbor_zip') -
          Number(a.route_fit === 'neighbor_zip') ||
        b.lifetime_value - a.lifetime_value ||
        a.name.localeCompare(b.name),
    )
  for (const c of candidates) {
    const home = c.address
      ? normalizeHouseholdKey({ street: c.address.street, zip: c.address.zip })
      : null
    if (!c.exclusions.length && c.phone) {
      if (seenPhones.has(c.phone) || (home && seenHomes.has(home)))
        c.exclusions.push('duplicate_identity')
      else {
        seenPhones.add(c.phone)
        if (home) seenHomes.add(home)
      }
    }
    for (const reason of c.exclusions)
      exclusions[reason] = (exclusions[reason] || 0) + 1
  }
  return { candidates, exclusions }
}

function detourMiles(
  a: { latitude: number | null; longitude: number | null },
  c: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
) {
  const point = (p: typeof a) =>
    p.latitude !== null &&
    p.longitude !== null &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude >= 37 &&
    p.latitude <= 41 &&
    p.longitude >= -109.1 &&
    p.longitude <= -102
  if (!point(a) || !point(b) || !point(c)) return null
  const distance = (x: typeof a, y: typeof a) => {
    const rad = (n: number) => (n * Math.PI) / 180
    const lat = rad(y.latitude! - x.latitude!),
      lng = rad(y.longitude! - x.longitude!)
    const h =
      Math.sin(lat / 2) ** 2 +
      Math.cos(rad(x.latitude!)) *
        Math.cos(rad(y.latitude!)) *
        Math.sin(lng / 2) ** 2
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  }
  return (
    Math.round(
      Math.max(0, distance(a, c) + distance(c, b) - distance(a, b)) * 10,
    ) / 10
  )
}

export function verifiedGapGeocodeSource(value: string | null | undefined) {
  return [
    'nominatim-street-verified',
    'nominatim-street-verified-backfill',
    'colorado-state-address-point',
    'repair:colorado-springs-address-point',
  ].includes(value || '')
}
