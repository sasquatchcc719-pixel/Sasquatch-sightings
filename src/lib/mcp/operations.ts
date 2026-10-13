import { countUnreadInboundMessages } from '@/lib/conversations-unread'
import {
  STANDARD_ZIP_CODES,
  TRAVEL_CHARGE_AMOUNT,
  TRAVEL_CHARGE_ZIP_CODES,
  getServiceAreaDescription,
} from '@/lib/service-area'
import { createAdminClient } from '@/supabase/server'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from './release'

const TIMEZONE = 'America/Denver' as const
const APP_ORIGIN = 'https://sightings.sasquatchcarpet.com'
type AdminClient = ReturnType<typeof createAdminClient>

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
    server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    capabilities: [
      {
        area: 'appointments_and_dispatch',
        workflows: [
          'list appointments',
          'inspect appointment',
          'check availability',
          'preview and confirm a priced service booking',
          'preview and confirm reschedule, reassignment, notes, or cancellation',
        ],
        tools: [
          'list_appointments',
          'get_appointment',
          'get_availability',
          'preview_appointment_create',
          'execute_appointment_create',
          'preview_appointment_update',
          'execute_appointment_update',
        ],
        access: 'partial' as const,
        scope:
          'business:read for reads; business:write for confirmed changes; finance:write for a booking that creates an invoice; customer:contact only when its preview requests customer confirmation',
        side_effects: [
          'appointment record/calendar changes',
          'draft invoice creation and optional QuickBooks synchronization',
          'optional customer and staff notifications disclosed in the preview',
          'cancellation parking',
        ],
        approval:
          'OAuth owner grant; exact preview and action-time confirmation for changes',
        limitations: [
          'Availability assumes a 120-minute visit and is not a booking.',
          'Dispatch and completion are not yet exposed.',
          'Booking core rows commit through one service-role-only transaction; geocoding, reactivation suppression, notifications, reminders, and optional QuickBooks work are post-commit follow-ups.',
        ],
      },
      {
        area: 'customers_and_history',
        workflows: ['search customers', 'locate linked operational records'],
        tools: [
          'search_customers',
          'search_business_records',
          'preview_customer_update',
          'execute_customer_update',
        ],
        access: 'partial' as const,
        scope: 'business:read for reads; customers:write for confirmed updates',
        side_effects: [
          'customer/contact/address record changes',
          'address geocoding queue',
        ],
        approval:
          'OAuth owner grant; exact preview and confirmation for updates',
        limitations: [
          'Standalone customer creation, merge, blacklist controls, billing-policy changes, and deletion are not exposed; a confirmed booking may create or reuse its customer and address.',
          'Search returns compact references; use the specific detail tool where available.',
        ],
      },
      {
        area: 'estimates_and_pricing',
        workflows: [
          'list estimates',
          'inspect estimate',
          'inspect service catalog',
          'create or revise a saved draft estimate',
          'mark an unconverted estimate accepted or declined',
          'preview and send an estimate email',
          'convert an estimate to booked work and a draft invoice',
        ],
        tools: [
          'list_estimates',
          'get_estimate',
          'get_business_configuration',
          'preview_estimate_save',
          'execute_estimate_save',
          'preview_estimate_decision',
          'execute_estimate_decision',
          'preview_estimate_send',
          'execute_estimate_send',
          'preview_estimate_conversion',
          'execute_estimate_conversion',
        ],
        access: 'partial' as const,
        scope:
          'business:read for reads; estimates:write for confirmed estimate changes; business:write + finance:write for conversion; customer:contact only when a conversion preview requests communications',
        side_effects: [
          'draft estimate and line-item changes',
          'confirmed estimate status transitions',
          'confirmed customer estimate email through Resend',
          'atomic booked appointment and draft invoice creation from a confirmed conversion',
        ],
        approval:
          'OAuth owner grant; exact preview and confirmation for draft saves',
        limitations: [
          'Conversion customer communication is off by default and runs only after the atomic database commit when explicitly previewed.',
          'The created invoice remains draft; publishing, sending, charging, and payment collection are not exposed.',
          'Accepted/declined status changes record an internal business decision and do not impersonate a customer click or send owner alerts.',
          'Catalog prices are reference data, not a binding quote.',
        ],
      },
      {
        area: 'communications_and_calls',
        workflows: [
          'inspect inbound calls',
          'list and read full conversation records',
          'read retained inbound media',
          'save a reply draft',
          'preview and send one customer SMS or MMS',
          'review attention counts',
        ],
        tools: [
          'list_calls',
          'search_business_records',
          'get_operational_summary',
          'list_conversations',
          'get_conversation',
          'save_conversation_draft',
          'preview_customer_message',
          'execute_customer_message',
        ],
        access: 'available' as const,
        scope:
          'business:read for reads; communications:draft for saved drafts; customer:contact for confirmed sends',
        side_effects: [
          'saved draft changes',
          'Twilio customer contact and message history',
        ],
        approval:
          'OAuth owner grant; exact recipient/body/media preview and action-time confirmation before sends',
        limitations: [
          'Operational search remains compact; use conversation detail for bodies and short-lived private-media URLs.',
          'Email, Telegram control, and call-control actions are not exposed.',
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
        workflows: [
          'find invoices',
          'inspect invoice detail',
          'review unpaid invoice queue',
        ],
        tools: [
          'search_business_records',
          'get_invoice',
          'get_operational_summary',
        ],
        access: 'partial' as const,
        scope: 'business:read',
        side_effects: [],
        approval: 'OAuth owner grant',
        limitations: [
          'No payment links, charges, refunds, invoice publication, or payment recording. There is no direct QuickBooks administration/sync tool; confirmed booking or conversion can request only the existing narrowly scoped sync follow-up disclosed in its preview.',
        ],
      },
    ],
    unavailable: [
      'arbitrary HTTP, SQL, shell, code execution, environment, token, or security administration',
      'bulk customer contact or campaigns',
      'dispatch, completion, and customer notification execution for schedule changes',
      'invoice publication/sending/payment and recurring, commercial, restoration, referral, or Ranger mutations',
      'payment collection, payment-link creation, refunds, or direct QuickBooks administration/arbitrary sync control',
    ],
  }
}

export async function getBusinessConfiguration(
  supabase: AdminClient = createAdminClient(),
) {
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

export async function searchBusinessRecords(
  input: {
    query: string
    entity: SearchEntity
    limit: number
  },
  supabase: AdminClient = createAdminClient(),
) {
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
          app_url: `${APP_ORIGIN}/admin/operations/customers`,
        })
      }
    }
  }

  const customerIds = customers.map((row) => row.id)
  const appointmentRows: Array<Record<string, any>> = []
  const appointmentIdsForInvoices = new Set<string>()
  const requestedKinds = [
    ...(include(input.entity, 'appointment') ? ['appointment' as const] : []),
    ...(include(input.entity, 'estimate') ? ['estimate' as const] : []),
  ]

  if (exactId && requestedKinds.length > 0) {
    const response = await supabase
      .from('ops_appointments')
      .select(
        'id, customer_id, kind, appointment_date, start_time, status, estimate_status, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
      )
      .eq('id', exactId)
      .limit(1)
    if (response.error)
      missing.push(unavailable('appointment/estimate search', response.error))
    appointmentRows.push(...(response.data || []))
  } else if (customerIds.length > 0 && requestedKinds.length > 0) {
    const responses = await Promise.all(
      requestedKinds.map(async (kind) => {
        let query = supabase
          .from('ops_appointments')
          .select(
            'id, customer_id, kind, appointment_date, start_time, status, estimate_status, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
          )
          .in('customer_id', customerIds)
          .order('updated_at', { ascending: false })
          .limit(perQuery)
        query =
          kind === 'estimate'
            ? query.eq('kind', 'estimate')
            : query.neq('kind', 'estimate')
        return query
      }),
    )
    for (const response of responses) {
      if (response.error) {
        missing.push(unavailable('appointment/estimate search', response.error))
        continue
      }
      appointmentRows.push(...(response.data || []))
    }
  }

  for (const row of appointmentRows) {
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

  if (include(input.entity, 'invoice')) {
    for (const row of appointmentRows) appointmentIdsForInvoices.add(row.id)
    if (!exactId && customerIds.length > 0) {
      const dependency = await supabase
        .from('ops_appointments')
        .select('id')
        .in('customer_id', customerIds)
        .order('updated_at', { ascending: false })
        .limit(100)
      if (dependency.error) {
        missing.push(unavailable('invoice dependency search', dependency.error))
      } else {
        for (const row of dependency.data || [])
          appointmentIdsForInvoices.add(row.id)
      }
    }
    const appointmentIds = [...appointmentIdsForInvoices]
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
        app_url: `${APP_ORIGIN}/admin/conversations`,
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
  window: string
  note: string | null
  items: Array<Record<string, unknown>>
}

export async function getOperationalSummary(
  input: {
    days: number
    item_limit: number
  },
  supabase: AdminClient = createAdminClient(),
  clock = new Date(),
) {
  const clockMs = clock.getTime()
  const through = denverDate(new Date(clockMs + input.days * 86_400_000))
  const from = denverDate(clock)
  const since = new Date(clockMs - input.days * 86_400_000).toISOString()
  const now = clock.toISOString()
  const queries = await Promise.all([
    supabase
      .from('conversations')
      .select('id, phone_number, source, messages, admin_read_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(501),
    supabase
      .from('call_logs')
      .select('id, caller_phone, outcome, transcription, created_at')
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .in('outcome', ['voicemail', 'no-answer', 'inbound'])
      .order('created_at', { ascending: false })
      .limit(201),
    supabase
      .from('ops_appointments')
      .select(
        'id, customer_id, appointment_date, start_time, estimate_status, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, business_name)',
      )
      .eq('kind', 'estimate')
      .in('estimate_status', ['draft', 'sent'])
      .order('updated_at', { ascending: false })
      .limit(201),
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
      .limit(201),
    supabase
      .from('sms_logs')
      .select('id, recipient_phone, message_type, status, sent_at')
      .eq('status', 'failed')
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(201),
    supabase
      .from('ops_service_concerns')
      .select('id, customer_id, appointment_id, status, category, updated_at')
      .in('status', [
        'awaiting_customer',
        'ready_for_review',
        'approved_return',
      ])
      .order('updated_at', { ascending: false })
      .limit(201),
    supabase
      .from('cleaning_reminders')
      .select(
        'id, customer_id, appointment_id, status, scheduled_for, updated_at',
      )
      .eq('status', 'pending')
      .lt('scheduled_for', now)
      .order('scheduled_for')
      .limit(201),
    supabase
      .from('ops_invoices')
      .select(
        'id, invoice_number, appointment_id, status, payment_status, total, updated_at',
      )
      .in('status', ['ready', 'pending', 'sent'])
      .or('payment_status.neq.paid,payment_status.is.null')
      .order('updated_at', { ascending: false })
      .limit(201),
  ])
  const missing: string[] = []
  const queues: Queue[] = []
  const queueWindows: Record<Queue['name'], string> = {
    unanswered_messages:
      'Newest 500 conversation threads; all unread messages stored in each scanned thread.',
    missed_calls: `Inbound voicemail/no-answer/pending calls created since ${since}.`,
    pending_estimates:
      'All outstanding draft or sent estimates, capped to the newest 200.',
    unassigned_jobs: `Unassigned active jobs from ${from} through ${through}.`,
    scheduling_conflicts: `Not available; intended window would be ${from} through ${through}.`,
    failed_notifications: `Failed SMS log entries created since ${since}.`,
    service_concerns:
      'All concerns in awaiting_customer, ready_for_review, or approved_return.',
    overdue_followups: `Pending customer-requested cleaning reminders scheduled before ${now}.`,
    unpaid_invoices:
      'Invoices in ready, pending, or sent status whose payment status is not paid.',
  }
  const add = (
    name: Queue['name'],
    index: number,
    map: (rows: any[]) => any[],
    note: string | null = null,
    sourceCap = 200,
  ) => {
    const result = queries[index]
    if (result.error) {
      missing.push(unavailable(name, result.error))
      queues.push({
        name,
        count: null,
        status: 'unavailable',
        window: queueWindows[name],
        note: 'Source unavailable.',
        items: [],
      })
      return
    }
    const sourceRows = result.data || []
    const sourceTruncated = sourceRows.length > sourceCap
    const items = map(sourceRows.slice(0, sourceCap))
    if (sourceTruncated) {
      missing.push(`${name}: newest ${sourceCap} source records scanned`)
    }
    const truncationNote = sourceTruncated
      ? `Lower-bound count from the newest ${sourceCap} source records; older matching records may exist.`
      : null
    queues.push({
      name,
      count: items.length,
      status: sourceTruncated ? 'partial' : 'available',
      window: queueWindows[name],
      note: [truncationNote, note].filter(Boolean).join(' ') || null,
      items: items.slice(0, input.item_limit),
    })
  }

  add(
    'unanswered_messages',
    0,
    (rows) =>
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
                app_url: `${APP_ORIGIN}/admin/conversations`,
              },
            ]
          : []
      }),
    'Count is unread conversation threads; unread_messages is the per-thread inbound-message count.',
    500,
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
    window: queueWindows.scheduling_conflicts,
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
        app_url: `${APP_ORIGIN}/admin/operations/customers`,
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
