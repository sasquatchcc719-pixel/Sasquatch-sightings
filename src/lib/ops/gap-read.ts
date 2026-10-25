import type { SupabaseClient } from '@supabase/supabase-js'
import { calendarEventsToAppointmentWindows } from './availability'
import {
  digest,
  verifiedGapGeocodeSource,
  mountainDate,
  planGaps,
  rankGapCandidates,
  type Calendar,
  type Gap,
  type GapCustomer,
  type Contact,
  type HistoryEvidence,
} from './gap-planning'
import { normalizeFillPhone } from './tomorrow-fill-rules'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const norm = (v: unknown) =>
  str(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const num = (v: unknown) => (v == null ? null : Number(v))
/** All reads are paginated and fail closed. Never invoke legacy auto-seeding loaders. */
export async function readGapRows(
  db: SupabaseClient,
  table: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let offset = 0; offset < 50000; offset += 500) {
    const keys: Record<string, string[]> = {
      hcp_customer_history: ['hcp_id'],
      qb_historical_transactions: ['txn_type', 'qb_txn_id'],
      sms_marketing_consents: ['customer_id'],
      gap_outreach_contacts: ['source', 'source_id', 'phone'],
    }
    let query = db.from(table).select('*')
    for (const key of keys[table] || ['id']) query = query.order(key)
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw new Error(`${table} unavailable: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 500) return rows
  }
  throw new Error(
    `${table} exceeds planning bound; refusing partial eligibility`,
  )
}
export function validateGapRange(start: string, end: string, now = new Date()) {
  const days =
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
    86400000
  if (
    !Number.isFinite(days) ||
    days < 0 ||
    days > 30 ||
    start < mountainDate(now)
  )
    throw new Error('Use a future inclusive range of at most 31 days')
}
export async function readScheduleGaps(
  db: SupabaseClient,
  input: {
    start_date: string
    end_date: string
    required_minutes: number
    staff_id?: string
    requested_start_time?: string
  },
  now = new Date(),
) {
  validateGapRange(input.start_date, input.end_date, now)
  const [staff, daily, templates, overrides, appts, events, addresses] =
    await Promise.all(
      [
        'staff_users',
        'staff_daily_availability',
        'availability_templates',
        'availability_overrides',
        'ops_appointments',
        'ops_calendar_events',
        'ops_service_addresses',
      ].map((t) => readGapRows(db, t)),
    )
  const gaps: Gap[] = []
  const addressById = new Map(addresses.map((a) => [a.id, a]))
  for (
    let time = Date.parse(`${input.start_date}T12:00:00Z`);
    time <= Date.parse(`${input.end_date}T12:00:00Z`);
    time += 86400000
  ) {
    const date = new Date(time).toISOString().slice(0, 10)
    for (const person of staff.filter(
      (s) => s.is_active && (!input.staff_id || s.id === input.staff_id),
    )) {
      const specific = templates.filter(
        (t) => t.staff_user_id === person.id && t.is_active,
      )
      const ownTemplates = specific.length
        ? specific
        : templates.filter((t) => !t.staff_user_id && t.is_active)
      const dailySetting = daily.find(
        (d) => d.staff_user_id === person.id && d.date === date,
      )
      const calendar: Calendar = {
        date,
        staff_id: str(person.id),
        staff_name: str(person.display_name),
        open: dailySetting
          ? Boolean(dailySetting.is_open)
          : Boolean(person.default_open),
        templates: ownTemplates as unknown as Calendar['templates'],
        overrides: overrides.filter(
          (o) =>
            o.override_date === date &&
            (!o.staff_user_id || o.staff_user_id === person.id),
        ) as unknown as Calendar['overrides'],
        appointments: appts
          .filter(
            (a) =>
              a.appointment_date === date &&
              !a.is_subcontracted &&
              (!a.assigned_staff_user_id ||
                a.assigned_staff_user_id === person.id),
          )
          .map((a) => ({
            id: str(a.id),
            appointment_date: date,
            start_time: str(a.start_time),
            end_time: str(a.end_time),
            status: str(a.status),
            zip: str(addressById.get(a.service_address_id)?.zip_code) || null,
            location: verifiedLocation(
              addressById.get(a.service_address_id),
              addresses,
            ),
          })),
        events: events.filter(
          (e) =>
            str(e.start_date) <= date &&
            str(e.end_date) >= date &&
            (!e.assigned_staff_user_id ||
              e.assigned_staff_user_id === person.id ||
              e.assigned_staff_user_id === person.user_id),
        ) as unknown as Calendar['events'],
      }
      // Conversion uses the established calendar-event range semantics, including multi-day blocks.
      calendarEventsToAppointmentWindows(date, calendar.events)
      gaps.push(
        ...planGaps(
          calendar,
          input.required_minutes,
          input.requested_start_time,
        ),
      )
    }
  }
  return {
    data: gaps.sort(
      (a, b) =>
        Number(b.internal) - Number(a.internal) ||
        a.date.localeCompare(b.date) ||
        a.start_time.localeCompare(b.start_time),
    ),
    freshness: {
      generated_at: now.toISOString(),
      timezone: 'America/Denver' as const,
      partial: false,
      missing: [] as string[],
    },
    priority: 'internal_gaps_first' as const,
    alternate_times_allowed: true as const,
  }
}
export async function reloadGap(
  db: SupabaseClient,
  gap: Gap,
  now = new Date(),
) {
  const result = await readScheduleGaps(
    db,
    {
      start_date: gap.date,
      end_date: gap.date,
      required_minutes: 30,
      staff_id: gap.staff_id,
    },
    now,
  )
  const current = result.data.find(
    (g) =>
      g.start_time === gap.start_time &&
      g.end_time === gap.end_time &&
      g.version === gap.version,
  )
  if (!current)
    throw new Error('Gap changed or filled; owner must review a new plan')
  return current
}

export async function readGapCandidates(
  db: SupabaseClient,
  gap: Gap,
  limit: number,
  now = new Date(),
) {
  await reloadGap(db, gap, now)
  const tables = [
    'ops_customers',
    'ops_service_addresses',
    'ops_appointments',
    'hcp_customer_history',
    'qb_historical_transactions',
    'sms_marketing_consents',
    'ops_sms_consent_events',
    'staff_users',
    'blacklist',
    'sms_logs',
    'reactivation_email_log',
    'drip_email_log',
    'drip_campaign_enrollments',
    'conversations',
    'tomorrow_fill_recipients',
    'tomorrow_fill_settings',
    'telegram_relay_threads',
    'gap_outreach_contacts',
    'gap_outreach_recipients',
  ]
  const [
    customers,
    addresses,
    appointments,
    hcp,
    qb,
    consents,
    consentEvents,
    permissionOwners,
    blacklist,
    sms,
    email,
    dripEmail,
    dripEnrollments,
    conversations,
    fill,
    settings,
    relayThreads,
    gapContacts,
    gapRecipients,
  ] = await Promise.all(tables.map((t) => readGapRows(db, t)))
  const firstOps =
    appointments
      .filter((a) => a.status === 'completed')
      .map((a) => str(a.appointment_date))
      .sort()[0] || '9999-12-31'
  const all: GapCustomer[] = customers.map((c) => {
    const aliases = customers.filter(
      (a) =>
        a.id === c.id ||
        (normalizeFillPhone(str(a.phone)) &&
          normalizeFillPhone(str(a.phone)) ===
            normalizeFillPhone(str(c.phone))),
    )
    const ids = new Set(aliases.map((a) => a.id))
    const phones = new Set(
      aliases.map((a) => normalizeFillPhone(str(a.phone))).filter(Boolean),
    )
    const emails = new Set(
      aliases.map((a) => str(a.email).toLowerCase()).filter(Boolean),
    )
    const matchesName = (name: unknown) =>
      [
        c.full_name,
        c.business_name,
        [c.first_name, c.last_name].filter(Boolean).join(' '),
      ].some((v) => norm(v) && norm(v) === norm(name))
    const myAppts = appointments.filter((a) => ids.has(a.customer_id))
    const service = myAppts
      .filter(
        (a) =>
          a.status === 'completed' &&
          a.kind === 'service' &&
          !a.restoration_project_id,
      )
      .sort((a, b) =>
        str(b.appointment_date).localeCompare(str(a.appointment_date)),
      )
    const myHcp = hcp.filter(
      (h) =>
        ids.has(h.ops_customer_id) ||
        (!h.ops_customer_id && matchesName(h.customer_name)),
    )
    const history: HistoryEvidence[] = service.map((a) => ({
      source: 'operations',
      record_id: str(a.id),
      date: str(a.appointment_date),
      date_kind: 'completed_service',
      verified: true,
      duration_minutes: duration(str(a.start_time), str(a.end_time)),
      value: Number(a.quoted_total || 0),
    }))
    for (const h of myHcp)
      if (h.last_service_date_hcp)
        history.push({
          source: 'housecall_pro',
          record_id: str(h.id || h.hcp_id),
          date: str(h.last_service_date_hcp),
          date_kind: 'service_snapshot',
          verified: Boolean(h.ops_customer_id),
          duration_minutes: null,
          value: qb.some(
            (q) =>
              str(q.txn_date) < firstOps &&
              ((c.quickbooks_customer_id &&
                str(c.quickbooks_customer_id) === str(q.qb_customer_id)) ||
                matchesName(q.customer_name)),
          )
            ? 0
            : Number(h.lifetime_value || 0),
        })
    for (const q of qb.filter(
      (q) =>
        str(q.txn_date) < firstOps &&
        aliases.some(
          (a) =>
            (a.quickbooks_customer_id &&
              str(a.quickbooks_customer_id) === str(q.qb_customer_id)) ||
            matchesName(q.customer_name),
        ),
    ))
      history.push({
        source: 'quickbooks',
        record_id: `${str(q.txn_type)}:${str(q.qb_txn_id)}`,
        date: str(q.txn_date),
        date_kind: 'accounting_transaction',
        verified: false,
        duration_minutes: null,
        value: Number(q.total || 0),
      })
    const owned = conversations
      .filter(
        (t) =>
          ids.has(t.ops_customer_id) ||
          phones.has(normalizeFillPhone(str(t.phone_number))),
      )
      .sort((a, b) => str(b.updated_at).localeCompare(str(a.updated_at)))
    const contacts: Contact[] = []
    for (const m of sms.filter(
      (m) =>
        ids.has(m.customer_id) ||
        phones.has(normalizeFillPhone(str(m.recipient_phone))),
    ))
      if (m.status !== 'failed')
        contacts.push({
          channel: 'sms',
          at: str(m.sent_at || m.created_at),
          direction: 'outbound',
          source_id: str(m.twilio_sid || m.id),
        })
    for (const m of email.filter(
      (m) =>
        ids.has(m.customer_id) || emails.has(str(m.to_email).toLowerCase()),
    ))
      if (m.event_type === 'email' && m.status === 'sent')
        contacts.push({
          channel: 'email',
          at: str(m.sent_at),
          direction: 'outbound',
          source_id: str(m.id),
        })
    const myDripEnrollments = new Set(
      dripEnrollments.filter((e) => ids.has(e.customer_id)).map((e) => e.id),
    )
    for (const message of dripEmail.filter(
      (m) =>
        myDripEnrollments.has(m.enrollment_id) ||
        emails.has(str(m.to_email).trim().toLowerCase()),
    ))
      if (message.status === 'sent')
        contacts.push({
          channel: 'drip_email',
          at: str(message.sent_at),
          direction: 'outbound',
          source_id: `drip_email:${str(message.id)}`,
        })
    for (const t of owned)
      for (const m of (Array.isArray(t.messages) ? t.messages : []) as Row[])
        contacts.push({
          channel: 'conversation',
          at: str(m.timestamp),
          direction: m.role === 'user' ? 'inbound' : 'outbound',
          source_id: str(m.twilio_sid) || digest(m),
        })
    for (const contact of gapContacts.filter((c) => phones.has(str(c.phone))))
      contacts.push({
        channel: str(contact.source),
        at: str(contact.contacted_at),
        direction: 'outbound',
        source_id: str(contact.source_id),
      })
    // Same provider message can occur in both logs and conversation history. Count it once.
    const deduped = [
      ...new Map(
        contacts.filter((m) => m.at).map((m) => [m.source_id, m]),
      ).values(),
    ]
    const latestInbound = deduped
      .filter((c) => c.direction === 'inbound')
      .map((c) => c.at)
      .sort()
      .at(-1)
    if (latestInbound)
      for (const contact of deduped)
        if (contact.direction === 'outbound' && contact.at < latestInbound)
          contact.replied_at = latestInbound
    for (const f of fill.filter(
      (f) => ids.has(f.customer_id) || phones.has(str(f.phone_normalized)),
    ))
      if (f.sent_at) {
        const contact = deduped.find(
          (m) => m.source_id === f.twilio_sid || m.at === f.sent_at,
        )
        if (contact) {
          contact.replied_at = str(f.replied_at) || null
          contact.booked_at = str(f.booked_at) || null
        }
      }
    const selectedAddress =
      addresses.find((a) => a.id === service[0]?.service_address_id) ||
      addresses.find((a) => ids.has(a.customer_id))
    const myConsents = consents.filter(
      (s) => ids.has(s.customer_id) || phones.has(str(s.phone_normalized)),
    )
    const optOutEvent = consentEvents.some(
      (e) =>
        e.action === 'opted_out' &&
        (ids.has(e.customer_id) ||
          phones.has(normalizeFillPhone(str(e.phone)))),
    )
    const ownerEvent = consentEvents
      .filter(
        (e) =>
          e.customer_id === c.id &&
          e.action === 'owner_attested_existing_permission' &&
          e.source === 'owner_attestation' &&
          normalizeFillPhone(str(e.phone)) ===
            normalizeFillPhone(str(c.phone)) &&
          str(e.evidence_ref).endsWith(`#customer=${str(c.id)}`) &&
          e.owner_attested_at &&
          Date.parse(str(e.owner_attested_at)) <= now.getTime() &&
          str(e.consent_text).trim() &&
          permissionOwners.some(
            (owner) =>
              owner.user_id === e.user_id &&
              owner.role === 'owner' &&
              owner.is_active,
          ),
      )
      .sort((a, b) =>
        str(b.owner_attested_at).localeCompare(str(a.owner_attested_at)),
      )[0]
    const consent =
      myConsents.find((s) => s.status === 'opted_out') ||
      myConsents.find((s) => s.status === 'opted_in' && s.consented_at) ||
      myConsents[0]
    return {
      id: str(c.id),
      name: str(c.full_name),
      phone: str(c.phone) || null,
      internal: Boolean(c.is_internal),
      commercial: Boolean(c.is_commercial),
      address: selectedAddress
        ? {
            id: str(selectedAddress.id),
            street: str(selectedAddress.street_1),
            city: str(selectedAddress.city),
            zip: str(selectedAddress.zip_code),
            latitude: num(selectedAddress.latitude),
            longitude: num(selectedAddress.longitude),
            geocode_source: safeGeocodeSource(selectedAddress, addresses),
          }
        : null,
      history,
      contacts: deduped,
      conversation_id: str(owned[0]?.id) || null,
      conversation_updated_at: str(owned[0]?.updated_at) || null,
      business_number:
        str(
          relayThreads.find((t) => phones.has(normalizeFillPhone(str(t.phone))))
            ?.business_number,
        ) || null,
      unresolved_outreach: gapRecipients.some(
        (r) => phones.has(str(r.phone)) && r.status === 'unknown',
      ),
      blocked: blacklist.some((b) =>
        phones.has(normalizeFillPhone(str(b.phone))),
      ),
      do_not_contact: myHcp.some((h) => h.do_not_contact),
      future_booking: myAppts.some(
        (a) =>
          str(a.appointment_date) >= mountainDate(now) &&
          [
            'booked',
            'confirmed',
            'on_my_way',
            'in_progress',
            'pending_approval',
          ].includes(str(a.status)),
      ),
      unresolved_job: myAppts.some(
        (a) =>
          a.parked_at ||
          (str(a.appointment_date) < mountainDate(now) &&
            a.kind === 'service' &&
            ['booked', 'confirmed', 'on_my_way', 'in_progress'].includes(
              str(a.status),
            )),
      ),
      open_estimate: myAppts.some(
        (a) =>
          a.kind === 'estimate' &&
          a.status !== 'cancelled' &&
          !a.converted_appointment_id &&
          !['declined', 'converted'].includes(str(a.estimate_status)),
      ),
      consent: optOutEvent
        ? {
            status: 'opted_out',
            source: 'consent_event',
            consented_at: null,
            disclosure: null,
          }
        : consent?.status !== 'opted_out' &&
            !(
              consent?.status === 'opted_in' &&
              consent.consented_at &&
              consent.disclosure
            ) &&
            ownerEvent
          ? {
              status: 'owner_attested',
              source: 'owner_attestation',
              consented_at: null,
              disclosure: str(ownerEvent.consent_text),
              customer_id: str(c.id),
              phone: str(ownerEvent.phone),
              owner_user_id: str(ownerEvent.user_id),
              owner_attested_at: str(ownerEvent.owner_attested_at),
              evidence_ref: str(ownerEvent.evidence_ref),
            }
          : consent
            ? {
                status: str(consent.status),
                source: str(consent.source),
                consented_at: str(consent.consented_at) || null,
                disclosure: str(consent.disclosure) || null,
              }
            : null,
    }
  })
  const s = settings[0]
  if (!s) throw new Error('Tomorrow Fill eligibility settings missing')
  const ranked = rankGapCandidates(all, gap, now, {
    dormancy_months: Number(s.dormancy_months),
    customer_cooldown_days: Number(s.customer_cooldown_days),
    unanswered_limit: Number(s.unanswered_limit),
    rest_days: Number(s.rest_days),
  })
  return {
    data: ranked.candidates.filter((c) => !c.exclusions.length).slice(0, limit),
    excluded: ranked.candidates
      .filter((c) => c.exclusions.length)
      .slice(0, limit),
    exclusion_counts: ranked.exclusions,
    total_eligible: ranked.candidates.filter((c) => !c.exclusions.length)
      .length,
    eligibility_rules: {
      dormancy_months: Number(s.dormancy_months),
      customer_cooldown_days: Number(s.customer_cooldown_days),
      unanswered_limit: Number(s.unanswered_limit),
      rest_days: Number(s.rest_days),
      opt_out_always_blocks: true,
      history_requires_owner_review: true,
    },
    gap,
    freshness: {
      generated_at: now.toISOString(),
      timezone: 'America/Denver' as const,
      partial: false,
      missing: [] as string[],
    },
  }
}
function duration(start: string, end: string) {
  const value =
    (Date.parse(`2000-01-01T${end}`) - Date.parse(`2000-01-01T${start}`)) /
    60000
  return Number.isFinite(value) && value > 0 ? value : null
}

function safeGeocodeSource(address: Row, all: Row[]) {
  if (!verifiedGapGeocodeSource(str(address.geocode_source))) return null
  if (
    all.some(
      (other) =>
        other.id !== address.id &&
        other.latitude === address.latitude &&
        other.longitude === address.longitude &&
        norm(other.street_1) !== norm(address.street_1),
    )
  )
    return null
  return str(address.geocode_source)
}
function verifiedLocation(address: Row | undefined, all: Row[]) {
  if (!address || !safeGeocodeSource(address, all)) return null
  return {
    city: str(address.city),
    street: str(address.street_1),
    latitude: num(address.latitude),
    longitude: num(address.longitude),
  }
}
