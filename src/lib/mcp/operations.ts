import { countUnreadInboundMessages } from '@/lib/conversations-unread'
import {
  STANDARD_ZIP_CODES,
  TRAVEL_CHARGE_AMOUNT,
  TRAVEL_CHARGE_ZIP_CODES,
  getServiceAreaDescription,
} from '@/lib/service-area'
import { createAdminClient } from '@/supabase/server'

const TIMEZONE = 'America/Denver' as const
const APP_ORIGIN = 'https://sightings.sasquatchcarpet.com'

type SearchEntity =
  | 'all'
  | 'customer'
  | 'appointment'
  | 'estimate'
  | 'invoice'
  | 'conversation'

type SearchResult = {
  entity: Exclude<SearchEntity, 'all'>
  id: string
  label: string
  subtitle: string | null
  status: string | null
  updated_at: string | null
  matched_on: string
  app_url: string
}

function nowIso() {
  return new Date().toISOString()
}

function denverDate(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TIMEZONE })
}

function freshness(missing: string[] = []) {
  return {
    generated_at: nowIso(),
    timezone: TIMEZONE,
    partial: missing.length > 0,
    missing,
  }
}

function unavailable(label: string, error: unknown) {
  console.error(`[mcp/read] ${label} unavailable:`, error)
  return `${label}: unavailable`
}

export function getCapabilityCatalog() {
  return {
    generated_at: nowIso(),
    server: { name: 'sasquatch-sightings-read', version: '1.1.0' },
    capabilities: [
      {
        area: 'appointments_and_dispatch',
        workflows: [
          'list appointments',
          'inspect appointment',
          'check availability',
        ],
        tools: ['list_appointments', 'get_appointment', 'get_availability'],
        access: 'available' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant; no action-time confirmation for reads',
        limitations: [
          'Availability assumes a 120-minute visit and is not a booking.',
          'Create, reschedule, assign, dispatch, complete, and cancel are not exposed.',
        ],
      },
      {
        area: 'customers_and_history',
        workflows: ['search customers', 'locate linked operational records'],
        tools: ['search_customers', 'search_business_records'],
        access: 'partial' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'Customer/location create, update, merge, blacklist, and delete are not exposed.',
          'Search returns compact references; use the specific detail tool where available.',
        ],
      },
      {
        area: 'estimates_and_pricing',
        workflows: [
          'list estimates',
          'inspect estimate',
          'inspect service catalog',
        ],
        tools: ['list_estimates', 'get_estimate', 'get_business_configuration'],
        access: 'available' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'Drafting, sending, accepting, declining, converting, and repricing are not exposed.',
          'Catalog prices are reference data, not a binding quote.',
        ],
      },
      {
        area: 'communications_and_calls',
        workflows: [
          'inspect inbound calls',
          'find conversation records',
          'review attention counts',
        ],
        tools: [
          'list_calls',
          'search_business_records',
          'get_operational_summary',
        ],
        access: 'partial' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'Message bodies and media are not returned by operational search.',
          'Draft/send SMS, MMS, email, Telegram relay, and call-control actions are not exposed.',
        ],
      },
      {
        area: 'operations_control_center',
        workflows: [
          'review attention queues',
          'inspect configuration',
          'cross-entity search',
        ],
        tools: [
          'get_operational_summary',
          'get_business_configuration',
          'search_business_records',
        ],
        access: 'partial' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'Scheduling conflicts are reported unavailable until the existing conflict engine has a read-only batch interface.',
          'Queue results are capped and include freshness/partial indicators.',
        ],
      },
      {
        area: 'financial_and_external_integrations',
        workflows: ['find invoices', 'review unpaid invoice queue'],
        tools: ['search_business_records', 'get_operational_summary'],
        access: 'partial' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'No payment links, charges, refunds, invoice publication, QuickBooks sync, or financial commitments.',
        ],
      },
    ],
    unavailable: [
      'arbitrary HTTP, SQL, shell, code execution, environment, token, or security administration',
      'customer contact or campaigns',
      'bookings, rescheduling, dispatch, cancellations, or status mutations',
      'customer, location, estimate, invoice, recurring, commercial, restoration, referral, or Ranger mutations',
      'payment collection, payment-link creation, refunds, or QuickBooks writes',
    ],
  }
}

export async function getBusinessConfiguration() {
  const supabase = createAdminClient()
  const today = denverDate()
  const [services, templates, overrides] = await Promise.all([
    supabase
      .from('service_catalog_items')
      .select(
        'id, name, slug, description, category, base_price, pricing_unit, default_duration_minutes, buffer_minutes, online_booking_enabled, is_active, sort_order',
      )
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name'),
    supabase
      .from('availability_templates')
      .select(
        'id, day_of_week, start_time, end_time, slot_interval_minutes, is_active',
      )
      .order('day_of_week')
      .order('start_time'),
    supabase
      .from('availability_overrides')
      .select('id, override_date, start_time, end_time, is_available, reason')
      .gte('override_date', today)
      .order('override_date')
      .order('start_time')
      .limit(200),
  ])

  const missing: string[] = []
  if (services.error)
    missing.push(unavailable('service_catalog', services.error))
  if (templates.error)
    missing.push(unavailable('business_hours', templates.error))
  if (overrides.error)
    missing.push(unavailable('availability_overrides', overrides.error))
  missing.push(
    'holidays: no separate holiday calendar exists; dated availability overrides are returned instead',
  )
  missing.push(
    'notification settings: not exposed because existing rows include routing and provider-sensitive fields',
  )

  return {
    freshness: freshness(missing),
    timezone: TIMEZONE,
    service_area: {
      description: getServiceAreaDescription(),
      standard_zip_codes: [...STANDARD_ZIP_CODES].sort(),
      travel_charge_zip_codes: [...TRAVEL_CHARGE_ZIP_CODES].sort(),
      travel_charge_amount: TRAVEL_CHARGE_AMOUNT,
    },
    business_hours: (templates.data || []) as Array<Record<string, unknown>>,
    availability_overrides: (overrides.data || []) as Array<
      Record<string, unknown>
    >,
    service_catalog: (services.data || []) as Array<Record<string, unknown>>,
    scheduling: {
      availability_assumption_minutes: 120 as const,
      booking_effect: 'informational_only' as const,
    },
  }
}

function include(entity: SearchEntity, wanted: Exclude<SearchEntity, 'all'>) {
  return entity === 'all' || entity === wanted
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

export async function searchBusinessRecords(input: {
  query: string
  entity: SearchEntity
  limit: number
}) {
  const supabase = createAdminClient()
  const q = input.query.trim()
  const searchTerm = q.replace(/[,%_()]/g, ' ').trim()
  const exactId = isUuid(q) ? q : null
  const perQuery = Math.min(input.limit, 25)
  const missing: string[] = []
  const results: SearchResult[] = []

  let customers: Array<Record<string, any>> = []
  if (searchTerm && (!isUuid(q) || include(input.entity, 'customer'))) {
    const customerQueries = exactId
      ? ([['id', 'id']] as const)
      : ([
          ['full_name', 'name'],
          ['business_name', 'business_name'],
          ['phone', 'phone'],
          ['email', 'email'],
        ] as const)
    const settled = await Promise.all(
      customerQueries.map(async ([column, matchedOn]) => {
        let query = supabase
          .from('ops_customers')
          .select('id, full_name, business_name, phone, email, updated_at')
          .order('updated_at', { ascending: false })
          .limit(perQuery)
        query = exactId
          ? query.eq('id', exactId)
          : query.ilike(column, `%${searchTerm}%`)
        const response = await query
        return { ...response, matchedOn }
      }),
    )
    const byId = new Map<string, Record<string, any>>()
    for (const response of settled) {
      if (response.error) {
        missing.push(unavailable('customer search', response.error))
        continue
      }
      for (const row of response.data || []) {
        if (!byId.has(row.id))
          byId.set(row.id, { ...row, matchedOn: response.matchedOn })
      }
    }
    customers = [...byId.values()]
    if (include(input.entity, 'customer')) {
      for (const row of customers) {
        results.push({
          entity: 'customer',
          id: row.id,
          label: row.business_name || row.full_name || 'Unnamed customer',
          subtitle: [row.phone, row.email].filter(Boolean).join(' · ') || null,
          status: null,
          updated_at: row.updated_at || null,
          matched_on: row.matchedOn,
          app_url: `${APP_ORIGIN}/admin/operations/customers?customer=${encodeURIComponent(row.id)}`,
        })
      }
    }
  }

  const customerIds = customers.map((row) => row.id)
  if (
    include(input.entity, 'appointment') ||
    include(input.entity, 'estimate')
  ) {
    let query = supabase
      .from('ops_appointments')
      .select(
        'id, customer_id, kind, appointment_date, start_time, status, estimate_status, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
      )
      .order('updated_at', { ascending: false })
      .limit(perQuery)
    if (exactId) query = query.eq('id', exactId)
    else if (customerIds.length) query = query.in('customer_id', customerIds)
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    const response = await query
    if (response.error)
      missing.push(unavailable('appointment/estimate search', response.error))
    for (const row of response.data || []) {
      const customer = Array.isArray(row.ops_customers)
        ? row.ops_customers[0]
        : row.ops_customers
      const entity = row.kind === 'estimate' ? 'estimate' : 'appointment'
      if (!include(input.entity, entity)) continue
      const base = entity === 'estimate' ? 'estimates' : ''
      results.push({
        entity,
        id: row.id,
        label:
          customer?.business_name ||
          customer?.full_name ||
          `${entity} ${row.id.slice(0, 8)}`,
        subtitle: `${row.appointment_date}${row.start_time ? ` ${String(row.start_time).slice(0, 5)}` : ''}`,
        status: entity === 'estimate' ? row.estimate_status : row.status,
        updated_at: row.updated_at || null,
        matched_on: exactId ? 'id' : 'customer',
        app_url:
          entity === 'appointment'
            ? `${APP_ORIGIN}/admin/operations/appointments/${row.id}`
            : `${APP_ORIGIN}/admin/operations/${base}/${row.id}`,
      })
    }
  }

  if (include(input.entity, 'invoice')) {
    const appointmentIds = results
      .filter(
        (row) => row.entity === 'appointment' || row.entity === 'estimate',
      )
      .map((row) => row.id)
    let query = supabase
      .from('ops_invoices')
      .select(
        'id, invoice_number, appointment_id, status, payment_status, total, updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(perQuery)
    if (exactId) query = query.eq('id', exactId)
    else if (/^\d+$/.test(q)) query = query.eq('invoice_number', Number(q))
    else if (appointmentIds.length)
      query = query.in('appointment_id', appointmentIds)
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    const response = await query
    if (response.error)
      missing.push(unavailable('invoice search', response.error))
    for (const row of response.data || []) {
      results.push({
        entity: 'invoice',
        id: row.id,
        label: row.invoice_number
          ? `Invoice #${row.invoice_number}`
          : `Invoice ${row.id.slice(0, 8)}`,
        subtitle: row.total == null ? null : `$${Number(row.total).toFixed(2)}`,
        status: row.payment_status || row.status || null,
        updated_at: row.updated_at || null,
        matched_on: exactId
          ? 'id'
          : /^\d+$/.test(q)
            ? 'invoice_number'
            : 'customer appointment',
        app_url: `${APP_ORIGIN}/admin/operations/invoices/${row.id}`,
      })
    }
  }

  if (include(input.entity, 'conversation')) {
    let query = supabase
      .from('conversations')
      .select('id, phone_number, source, status, updated_at, ops_customer_id')
      .order('updated_at', { ascending: false })
      .limit(perQuery)
    if (exactId) query = query.eq('id', exactId)
    else if (customerIds.length)
      query = query.in('ops_customer_id', customerIds)
    else if (searchTerm) query = query.ilike('phone_number', `%${searchTerm}%`)
    else query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    const response = await query
    if (response.error)
      missing.push(unavailable('conversation search', response.error))
    for (const row of response.data || []) {
      results.push({
        entity: 'conversation',
        id: row.id,
        label: row.phone_number || `Conversation ${row.id.slice(0, 8)}`,
        subtitle: row.source || null,
        status: row.status || null,
        updated_at: row.updated_at || null,
        matched_on: exactId ? 'id' : customerIds.length ? 'customer' : 'phone',
        app_url: `${APP_ORIGIN}/admin/conversations?conversation=${row.id}`,
      })
    }
  }

  const deduped = [
    ...new Map(results.map((row) => [`${row.entity}:${row.id}`, row])).values(),
  ]
    .sort((a, b) =>
      String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
    )
    .slice(0, input.limit)

  return {
    freshness: freshness([...new Set(missing)]),
    query: q,
    data: deduped,
    pagination: { limit: input.limit, returned: deduped.length },
  }
}

type Queue = {
  name:
    | 'unanswered_messages'
    | 'missed_calls'
    | 'pending_estimates'
    | 'unassigned_jobs'
    | 'scheduling_conflicts'
    | 'failed_notifications'
    | 'service_concerns'
    | 'overdue_followups'
    | 'unpaid_invoices'
  count: number | null
  status: 'available' | 'partial' | 'unavailable'
  note: string | null
  items: Array<Record<string, unknown>>
}

export async function getOperationalSummary(input: {
  days: number
  item_limit: number
}) {
  const supabase = createAdminClient()
  const through = denverDate(new Date(Date.now() + input.days * 86_400_000))
  const from = denverDate()
  const since = new Date(Date.now() - input.days * 86_400_000).toISOString()
  const now = nowIso()
  const queries = await Promise.all([
    supabase
      .from('conversations')
      .select('id, phone_number, source, messages, admin_read_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabase
      .from('call_logs')
      .select('id, caller_phone, outcome, transcription, created_at')
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .in('outcome', ['voicemail', 'no-answer', 'inbound'])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('ops_appointments')
      .select(
        'id, customer_id, appointment_date, start_time, estimate_status, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
      )
      .eq('kind', 'estimate')
      .in('estimate_status', ['draft', 'sent'])
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('ops_appointments')
      .select(
        'id, appointment_date, start_time, status, updated_at, customer_id',
      )
      .neq('kind', 'estimate')
      .gte('appointment_date', from)
      .lte('appointment_date', through)
      .is('assigned_staff_user_id', null)
      .not('status', 'in', '(completed,cancelled)')
      .order('appointment_date')
      .limit(200),
    supabase
      .from('sms_logs')
      .select('id, recipient_phone, message_type, status, sent_at')
      .eq('status', 'failed')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(200),
    supabase
      .from('ops_service_concerns')
      .select('id, customer_id, appointment_id, status, category, updated_at')
      .in('status', [
        'awaiting_customer',
        'ready_for_review',
        'approved_return',
      ])
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('cleaning_reminders')
      .select(
        'id, customer_id, appointment_id, status, scheduled_for, updated_at',
      )
      .eq('status', 'pending')
      .lt('scheduled_for', now)
      .order('scheduled_for')
      .limit(200),
    supabase
      .from('ops_invoices')
      .select(
        'id, invoice_number, appointment_id, status, payment_status, total, updated_at',
      )
      .or('payment_status.neq.paid,payment_status.is.null')
      .order('updated_at', { ascending: false })
      .limit(200),
  ])
  const missing: string[] = []
  const queues: Queue[] = []
  const add = (
    name: Queue['name'],
    index: number,
    map: (rows: any[]) => any[],
    note: string | null = null,
  ) => {
    const result = queries[index]
    if (result.error) {
      missing.push(unavailable(name, result.error))
      queues.push({
        name,
        count: null,
        status: 'unavailable',
        note: 'Source unavailable.',
        items: [],
      })
      return
    }
    const items = map(result.data || [])
    queues.push({
      name,
      count: items.length,
      status: items.length >= 200 ? 'partial' : 'available',
      note: items.length >= 200 ? 'Capped at 200 records.' : note,
      items: items.slice(0, input.item_limit),
    })
  }

  add('unanswered_messages', 0, (rows) =>
    rows.flatMap((row) => {
      const unread = countUnreadInboundMessages({
        messages: Array.isArray(row.messages) ? row.messages : [],
        admin_read_at: row.admin_read_at,
      })
      return unread > 0
        ? [
            {
              id: row.id,
              phone: row.phone_number || null,
              source: row.source || null,
              unread_messages: unread,
              updated_at: row.updated_at,
              app_url: `${APP_ORIGIN}/admin/conversations?conversation=${row.id}`,
            },
          ]
        : []
    }),
  )
  add('missed_calls', 1, (rows) =>
    rows.map((row) => ({
      id: row.id,
      caller_phone: row.caller_phone || null,
      outcome: row.outcome,
      has_transcription: Boolean(row.transcription),
      created_at: row.created_at,
      app_url: `${APP_ORIGIN}/admin/call-logs`,
    })),
  )
  add('pending_estimates', 2, (rows) =>
    rows.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      appointment_date: row.appointment_date,
      start_time: row.start_time,
      status: row.estimate_status,
      updated_at: row.updated_at,
      app_url: `${APP_ORIGIN}/admin/operations/estimates/${row.id}`,
    })),
  )
  add('unassigned_jobs', 3, (rows) =>
    rows.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      appointment_date: row.appointment_date,
      start_time: row.start_time,
      status: row.status,
      app_url: `${APP_ORIGIN}/admin/operations/appointments/${row.id}`,
    })),
  )
  queues.push({
    name: 'scheduling_conflicts',
    count: null,
    status: 'unavailable',
    note: 'The existing conflict checker is request-scoped and has no read-only batch queue. No conflicts are inferred.',
    items: [],
  })
  missing.push(
    'scheduling_conflicts: no read-only batch interface in the existing scheduling engine',
  )
  add('failed_notifications', 4, (rows) =>
    rows.map((row) => ({
      id: row.id,
      recipient_phone: row.recipient_phone || null,
      message_type: row.message_type,
      status: row.status,
      sent_at: row.sent_at,
      app_url: `${APP_ORIGIN}/admin/operations/communications`,
    })),
  )
  add('service_concerns', 5, (rows) =>
    rows.map((row) => ({
      id: row.id,
      customer_id: row.customer_id,
      appointment_id: row.appointment_id,
      status: row.status,
      category: row.category,
      updated_at: row.updated_at,
      app_url: `${APP_ORIGIN}/admin/operations/service-concerns`,
    })),
  )
  add(
    'overdue_followups',
    6,
    (rows) =>
      rows.map((row) => ({
        id: row.id,
        customer_id: row.customer_id,
        appointment_id: row.appointment_id,
        scheduled_for: row.scheduled_for,
        status: row.status,
        app_url: `${APP_ORIGIN}/admin/operations/customers?customer=${row.customer_id}`,
      })),
    'Customer-requested cleaning reminders only; general promised follow-ups are not stored in one canonical queue.',
  )
  add('unpaid_invoices', 7, (rows) =>
    rows.map((row) => ({
      id: row.id,
      invoice_number: row.invoice_number,
      appointment_id: row.appointment_id,
      status: row.status,
      payment_status: row.payment_status,
      total: row.total,
      updated_at: row.updated_at,
      app_url: `${APP_ORIGIN}/admin/operations/invoices/${row.id}`,
    })),
  )

  return { freshness: freshness(missing), window: { from, through }, queues }
}
