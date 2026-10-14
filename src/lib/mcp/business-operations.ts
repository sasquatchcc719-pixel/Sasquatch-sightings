import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/supabase/server'
import { normalizePhone } from '@/lib/blacklist'
import { countUnreadInboundMessages } from '@/lib/conversations-unread'
import { sendConversationReply } from '@/lib/ops/conversation-reply'
import {
  createAiStyleBooking,
  type CreateAiStyleBookingInput,
} from '@/lib/ops/create-ai-style-booking'
import {
  deliverPreparedEstimateQuote,
  prepareEstimateQuote,
} from '@/lib/ops/estimate-email-delivery'
import {
  executeAtomicEstimateConversion,
  prepareEstimateConversion,
  type PreparedEstimateConversion,
} from '@/lib/ops/estimate-conversion'
import { normalizeOpsPhone } from '@/lib/ops/phone'
import { normalizeTown } from '@/lib/geo/towns'
import { sendOpsLifecycleCommunications } from '@/lib/ops/communications'
import { ensureCustomerQuickBooksSyncJob } from '@/lib/ops/quickbooks-sync-jobs'
import {
  buildQuickBooksCustomerPayload,
  getQuickBooksSyncStatus,
} from '@/lib/quickbooks'
import { syncAppointmentToQuickBooks } from '@/lib/quickbooks-api'
import { cancelReactivationForCustomer } from '@/lib/ops/reactivation-campaign'
import { sendAdminSMS } from '@/lib/twilio'
import { sendOneSignalNotification } from '@/lib/onesignal'
import { sendBookingNotification, scheduleJobReminder } from '@/lib/telegram'
import {
  invalidateGeocodeForAddressUpdate,
  queueGeocodeForStoredAddress,
} from '@/lib/ops/forward-geocode'
import {
  getSlotsForStaff,
  getStaffPrioritizedSlots,
} from '@/lib/ops/staff-availability'

const APP_ORIGIN = 'https://sightings.sasquatchcarpet.com'
const PREVIEW_MINUTES = 10

type Db = SupabaseClient

function client(value?: Db): Db {
  return value ?? createAdminClient()
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function messageId(
  conversationId: string,
  index: number,
  message: Record<string, unknown>,
) {
  if (typeof message.twilio_sid === 'string' && message.twilio_sid) {
    return message.twilio_sid
  }
  return createHash('sha256')
    .update(
      `${conversationId}:${index}:${String(message.timestamp || '')}:${String(message.role || '')}:${String(message.content || '')}`,
    )
    .digest('hex')
    .slice(0, 32)
}

function projectMessage(conversationId: string, index: number, value: unknown) {
  const row =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    id: messageId(conversationId, index, row),
    direction:
      row.role === 'user' ? ('inbound' as const) : ('outbound' as const),
    content: typeof row.content === 'string' ? row.content : '',
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : null,
    sent_by: typeof row.sent_by === 'string' ? row.sent_by : null,
    provider_message_id:
      typeof row.twilio_sid === 'string' ? row.twilio_sid : null,
  }
}

export async function listConversations(
  input: {
    status?: 'active' | 'completed' | 'escalated'
    source?: string
    customer_id?: string
    phone?: string
    since?: string
    limit: number
    offset: number
  },
  supplied?: Db,
) {
  const supabase = client(supplied)
  let query = supabase
    .from('conversations')
    .select(
      'id, phone_number, source, lead_id, ops_customer_id, messages, ai_enabled, admin_read_at, status, created_at, updated_at',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(input.offset, input.offset + input.limit - 1)
  if (input.status) query = query.eq('status', input.status)
  if (input.source) query = query.ilike('source', input.source)
  if (input.customer_id) query = query.eq('ops_customer_id', input.customer_id)
  if (input.phone) query = query.eq('phone_number', input.phone)
  if (input.since) query = query.gte('updated_at', input.since)

  const { data, error, count } = await query
  if (error) throw error
  const rows = data || []
  const customerIds = Array.from(
    new Set(rows.map((row) => row.ops_customer_id).filter(Boolean)),
  ) as string[]
  const { data: customers, error: customerError } = customerIds.length
    ? await supabase
        .from('ops_customers')
        .select('id, full_name, business_name, phone, email')
        .in('id', customerIds)
    : { data: [], error: null }
  if (customerError) throw customerError
  const customerById = new Map((customers || []).map((row) => [row.id, row]))

  return {
    data: rows.map((row) => {
      const messages = Array.isArray(row.messages) ? row.messages : []
      const last = messages.length
        ? projectMessage(
            row.id,
            messages.length - 1,
            messages[messages.length - 1],
          )
        : null
      const customer = row.ops_customer_id
        ? customerById.get(row.ops_customer_id) || null
        : null
      return {
        id: row.id,
        phone_number: row.phone_number,
        source: row.source,
        status: row.status,
        ai_enabled: Boolean(row.ai_enabled),
        customer: customer
          ? {
              id: customer.id,
              name: customer.business_name || customer.full_name || null,
              phone: customer.phone || null,
              email: customer.email || null,
            }
          : null,
        unread_count: countUnreadInboundMessages({
          messages: messages as Array<{ role: string; timestamp?: string }>,
          admin_read_at: row.admin_read_at,
        }),
        last_message: last,
        created_at: row.created_at,
        updated_at: row.updated_at,
        app_url: `${APP_ORIGIN}/admin/conversations`,
      }
    }),
    pagination: {
      limit: input.limit,
      offset: input.offset,
      total: count ?? rows.length,
    },
  }
}

export async function getConversation(
  input: {
    id: string
    message_limit: number
    message_offset: number
    include_media: boolean
  },
  supplied?: Db,
) {
  const supabase = client(supplied)
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select(
      'id, phone_number, source, lead_id, ops_customer_id, messages, ai_enabled, admin_read_at, status, created_at, updated_at',
    )
    .eq('id', input.id)
    .maybeSingle()
  if (error) throw error
  if (!conversation) throw new Error('Conversation not found')

  const allMessages = Array.isArray(conversation.messages)
    ? conversation.messages
    : []
  const selected = allMessages.slice(
    input.message_offset,
    input.message_offset + input.message_limit,
  )
  const messages = selected.map((row, localIndex) =>
    projectMessage(conversation.id, input.message_offset + localIndex, row),
  )

  const { data: customer, error: customerError } = conversation.ops_customer_id
    ? await supabase
        .from('ops_customers')
        .select('id, full_name, business_name, phone, email, notes')
        .eq('id', conversation.ops_customer_id)
        .maybeSingle()
    : { data: null, error: null }
  if (customerError) throw customerError

  const { data: draft, error: draftError } = await supabase
    .from('mcp_saved_conversation_drafts')
    .select('id, body, status, created_at, updated_at')
    .eq('conversation_id', input.id)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (draftError && draftError.code !== '42P01') throw draftError

  let media: Array<Record<string, unknown>> = []
  if (input.include_media) {
    const providerIds = new Set(
      messages
        .map((message) => message.provider_message_id)
        .filter((id): id is string => Boolean(id)),
    )
    const { data: mediaRows, error: mediaError } = await supabase
      .from('ops_customer_media')
      .select(
        'id, twilio_message_sid, content_type, byte_size, status, category, error_message, storage_path, created_at',
      )
      .eq('conversation_id', input.id)
      .order('created_at', { ascending: true })
    if (mediaError) throw mediaError
    media = await Promise.all(
      (mediaRows || [])
        .filter(
          (row) =>
            providerIds.size === 0 || providerIds.has(row.twilio_message_sid),
        )
        .map(async (row) => {
          let url: string | null = null
          let expiresAt: string | null = null
          if (row.status === 'available' && row.storage_path) {
            const seconds = 15 * 60
            const signed = await supabase.storage
              .from('customer-media')
              .createSignedUrl(row.storage_path, seconds)
            url = signed.data?.signedUrl || null
            expiresAt = url
              ? new Date(Date.now() + seconds * 1000).toISOString()
              : null
          }
          return {
            id: row.id,
            provider_message_id: row.twilio_message_sid,
            content_type: row.content_type,
            byte_size: row.byte_size == null ? null : Number(row.byte_size),
            status: row.status,
            category: row.category,
            error: row.error_message,
            url,
            url_expires_at: expiresAt,
            created_at: row.created_at,
          }
        }),
    )
  }

  return {
    data: {
      id: conversation.id,
      phone_number: conversation.phone_number,
      source: conversation.source,
      status: conversation.status,
      ai_enabled: Boolean(conversation.ai_enabled),
      customer: customer
        ? {
            id: customer.id,
            name: customer.business_name || customer.full_name || null,
            phone: customer.phone,
            email: customer.email,
            notes: customer.notes,
          }
        : null,
      unread_count: countUnreadInboundMessages({
        messages: allMessages as Array<{ role: string; timestamp?: string }>,
        admin_read_at: conversation.admin_read_at,
      }),
      messages,
      message_pagination: {
        limit: input.message_limit,
        offset: input.message_offset,
        total: allMessages.length,
      },
      media,
      saved_draft: draft || null,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      app_url: `${APP_ORIGIN}/admin/conversations`,
    },
  }
}

const INVOICE_SELECT = `
  id, invoice_number, appointment_id, status, payment_status, subtotal,
  discount_amount, percentage_discount_amount, tax_amount,
  minimum_charge_adjustment, total, created_at, updated_at,
  ops_appointments (
    id, appointment_date, start_time, end_time, status, quoted_total,
    internal_notes,
    assigned_staff:staff_users!ops_appointments_assigned_staff_user_id_fkey (
      id, display_name
    ),
    ops_customers!ops_appointments_customer_id_fkey (
      id, full_name, first_name, last_name, business_name, email, phone
    ),
    ops_service_addresses (
      id, label, street_1, street_2, city, state, zip_code, gate_code, notes
    )
  ),
  ops_invoice_line_items (
    id, appointment_line_item_id, service_catalog_item_id, description,
    quantity, unit_price, line_total, excluded_at, excluded_reason
  )
`

export async function getInvoice(id: string, supplied?: Db) {
  const supabase = client(supplied)
  const { data: invoice, error } = await supabase
    .from('ops_invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!invoice) throw new Error('Invoice not found')
  const appointment = one(invoice.ops_appointments)
  const customer = appointment ? one(appointment.ops_customers) : null
  const address = appointment ? one(appointment.ops_service_addresses) : null
  const staff = appointment ? one(appointment.assigned_staff) : null
  return {
    data: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      appointment: appointment
        ? {
            id: appointment.id,
            date: appointment.appointment_date,
            start_time: appointment.start_time,
            end_time: appointment.end_time,
            status: appointment.status,
            quoted_total:
              appointment.quoted_total == null
                ? null
                : Number(appointment.quoted_total),
            internal_notes: appointment.internal_notes,
            technician: staff
              ? { id: staff.id, name: staff.display_name }
              : null,
          }
        : null,
      customer: customer
        ? {
            id: customer.id,
            name: customer.business_name || customer.full_name || null,
            first_name: customer.first_name,
            last_name: customer.last_name,
            business_name: customer.business_name,
            email: customer.email,
            phone: customer.phone,
          }
        : null,
      address: address || null,
      line_items: (invoice.ops_invoice_line_items || []).map((line) => ({
        id: line.id,
        appointment_line_item_id: line.appointment_line_item_id,
        service_id: line.service_catalog_item_id,
        description: line.description,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        line_total: Number(line.line_total),
        excluded: Boolean(line.excluded_at),
        excluded_reason: line.excluded_reason,
      })),
      subtotal: Number(invoice.subtotal || 0),
      discounts:
        Number(invoice.discount_amount || 0) +
        Number(invoice.percentage_discount_amount || 0),
      tax: Number(invoice.tax_amount || 0),
      minimum_charge_adjustment: Number(invoice.minimum_charge_adjustment || 0),
      total: Number(invoice.total || 0),
      status: invoice.status,
      payment_status: invoice.payment_status,
      created_at: invoice.created_at,
      updated_at: invoice.updated_at,
      app_url: `${APP_ORIGIN}/admin/operations/invoices/${invoice.id}`,
    },
  }
}

export type McpActor = {
  subject: string
  label: string
  scopes: string[]
}

function requireScope(actor: McpActor, scope: string) {
  if (!actor.scopes.includes(scope)) {
    throw new Error(`This OAuth grant does not include ${scope}`)
  }
}

export async function saveConversationDraft(
  input: { conversation_id: string; body: string },
  actor: McpActor,
  supplied?: Db,
) {
  requireScope(actor, 'communications:draft')
  const supabase = client(supplied)
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', input.conversation_id)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation) throw new Error('Conversation not found')

  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await supabase
    .from('mcp_saved_conversation_drafts')
    .select('id')
    .eq('conversation_id', input.conversation_id)
    .eq('created_by', actor.subject)
    .eq('status', 'draft')
    .maybeSingle()
  if (existingError) throw existingError

  const write = existing
    ? supabase
        .from('mcp_saved_conversation_drafts')
        .update({ body: input.body.trim(), updated_at: now })
        .eq('id', existing.id)
        .select('id, conversation_id, body, status, created_at, updated_at')
        .single()
    : supabase
        .from('mcp_saved_conversation_drafts')
        .insert({
          conversation_id: input.conversation_id,
          body: input.body.trim(),
          created_by: actor.subject,
        })
        .select('id, conversation_id, body, status, created_at, updated_at')
        .single()
  const { data, error } = await write
  if (error) throw error
  return { data, effect: 'Draft saved in Sightings. No message was sent.' }
}

type ActionType =
  | 'customer.update'
  | 'conversation.send'
  | 'appointment.create'
  | 'appointment.update'
  | 'estimate.save'
  | 'estimate.decision'
  | 'estimate.send'
  | 'estimate.convert'

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new TypeError('Confirmation payload must be JSON-serializable')
  }

  const normalized = JSON.parse(serialized) as unknown
  const serialize = (current: unknown): string => {
    if (Array.isArray(current)) {
      return `[${current.map(serialize).join(',')}]`
    }
    if (current !== null && typeof current === 'object') {
      const record = current as Record<string, unknown>
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`)
        .join(',')}}`
    }
    return JSON.stringify(current)
  }

  return serialize(normalized)
}

export function payloadHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

async function storePreview(params: {
  actor: McpActor
  actionType: ActionType
  requiredScope: string
  idempotencyKey: string
  payload: Record<string, unknown>
  preview: Record<string, unknown>
  supabase: Db
}) {
  requireScope(params.actor, params.requiredScope)
  const hash = payloadHash(params.payload)
  await params.supabase
    .from('mcp_action_previews')
    .update({ status: 'expired', action_payload: {}, preview: {} })
    .eq('actor_user_id', params.actor.subject)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
  const { data: existing, error: existingError } = await params.supabase
    .from('mcp_action_previews')
    .select('id, payload_hash, preview, status, expires_at')
    .eq('actor_user_id', params.actor.subject)
    .eq('action_type', params.actionType)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (existing.payload_hash !== hash) {
      throw new Error('Idempotency key was already used for a different action')
    }
    return {
      confirmation_id: existing.id,
      status: existing.status,
      expires_at: existing.expires_at,
      preview: existing.preview,
    }
  }

  const expiresAt = new Date(
    Date.now() + PREVIEW_MINUTES * 60_000,
  ).toISOString()
  const { data, error } = await params.supabase
    .from('mcp_action_previews')
    .insert({
      actor_user_id: params.actor.subject,
      action_type: params.actionType,
      action_payload: params.payload,
      payload_hash: hash,
      preview: params.preview,
      required_scope: params.requiredScope,
      idempotency_key: params.idempotencyKey,
      expires_at: expiresAt,
    })
    .select('id, preview, status, expires_at')
    .single()
  if (error) throw error
  return {
    confirmation_id: data.id,
    status: data.status,
    expires_at: data.expires_at,
    preview: data.preview,
  }
}

export async function previewCustomerUpdate(
  input: {
    customer_id: string
    customer?: Record<string, unknown>
    address?: Record<string, unknown>
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  const supabase = client(supplied)
  const { data: customer, error } = await supabase
    .from('ops_customers')
    .select(
      'id, first_name, last_name, full_name, business_name, email, phone, notes, email_opt_out, updated_at',
    )
    .eq('id', input.customer_id)
    .maybeSingle()
  if (error) throw error
  if (!customer) throw new Error('Customer not found')

  let address = null
  if (input.address?.id) {
    const result = await supabase
      .from('ops_service_addresses')
      .select(
        'id, customer_id, label, street_1, street_2, city, state, zip_code, gate_code, notes, updated_at',
      )
      .eq('id', String(input.address.id))
      .eq('customer_id', input.customer_id)
      .maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new Error('Service address not found for customer')
    address = result.data
  }

  const payload = {
    customer_id: input.customer_id,
    customer: input.customer || null,
    address: input.address || null,
    expected_customer_updated_at: customer.updated_at,
    expected_address_updated_at: address?.updated_at || null,
  }
  return storePreview({
    actor,
    actionType: 'customer.update',
    requiredScope: 'customers:write',
    idempotencyKey: input.idempotency_key,
    payload,
    preview: {
      action: 'Update customer or service address',
      customer_id: input.customer_id,
      before: { customer, address },
      requested_changes: {
        customer: input.customer || null,
        address: input.address || null,
      },
      effects: [
        'Updates the Sightings customer record.',
        ...(input.address
          ? [
              'Updates the selected service address and requeues geocoding if its location changes.',
            ]
          : []),
        'Does not contact the customer.',
      ],
    },
    supabase,
  })
}

export async function previewConversationSend(
  input: {
    conversation_id: string
    body: string
    media_ids: string[]
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  const supabase = client(supplied)
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('id, phone_number, ops_customer_id, updated_at')
    .eq('id', input.conversation_id)
    .maybeSingle()
  if (error) throw error
  if (!conversation) throw new Error('Conversation not found')
  const { data: thread, error: threadError } = await supabase
    .from('telegram_relay_threads')
    .select('business_number')
    .eq('phone', conversation.phone_number)
    .maybeSingle()
  if (threadError) throw threadError
  const { data: media, error: mediaError } = input.media_ids.length
    ? await supabase
        .from('ops_customer_media')
        .select('id, conversation_id, content_type, category, status')
        .in('id', input.media_ids)
        .eq('conversation_id', input.conversation_id)
        .eq('status', 'available')
    : { data: [], error: null }
  if (mediaError) throw mediaError
  if ((media || []).length !== input.media_ids.length) {
    throw new Error('Every attachment must be available in this conversation')
  }
  return storePreview({
    actor,
    actionType: 'conversation.send',
    requiredScope: 'customer:contact',
    idempotencyKey: input.idempotency_key,
    payload: {
      conversation_id: input.conversation_id,
      body: input.body.trim(),
      media_ids: input.media_ids,
      expected_updated_at: conversation.updated_at,
    },
    preview: {
      action: input.media_ids.length
        ? 'Send customer MMS'
        : 'Send customer SMS',
      conversation_id: input.conversation_id,
      to: conversation.phone_number,
      from: thread?.business_number || 'configured Sightings messaging sender',
      body: input.body.trim(),
      attachments: media || [],
      effects: [
        'Contacts this customer immediately through Twilio.',
        'Uses the original business number when Sightings has retained it.',
        'Appends the provider-confirmed outbound message to the conversation.',
        'Does not post a bot message to Telegram as a substitute for SMS.',
      ],
    },
    supabase,
  })
}

export async function previewAppointmentCreate(
  input: {
    customer: {
      first_name: string
      last_name: string
      email: string
      phone: string
    }
    address: {
      street_1: string
      street_2?: string
      city: string
      state: string
      zip_code: string
    }
    appointment_date: string
    start_time: string
    line_items: Array<{ service_id: string; quantity: number }>
    assigned_staff_user_id?: string
    lead_source: string
    lead_source_detail?: string | null
    accepted_minimum_charge: boolean
    notify_customer: boolean
    notify_internal: boolean
    sync_quickbooks: boolean
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  requireScope(actor, 'business:write')
  requireScope(actor, 'finance:write')
  if (input.notify_customer) requireScope(actor, 'customer:contact')

  const supabase = client(supplied)
  const bookingInput = {
    supabase,
    customer: {
      ...input.customer,
      phone: normalizeOpsPhone(input.customer.phone),
    },
    address: input.address,
    appointment_date: input.appointment_date,
    start_time: input.start_time,
    line_items: input.line_items,
    booking_mode: 'direct' as const,
    booking_channel: 'ai_agent' as const,
    source_label: 'Dot MCP',
    lead_source: input.lead_source,
    lead_source_detail: input.lead_source_detail || null,
    actor_label: `MCP (${actor.label})`,
    admin_heading: 'MCP booking',
    accepted_minimum_charge: input.accepted_minimum_charge,
    assigned_staff_user_id: input.assigned_staff_user_id || null,
    notify_customer: input.notify_customer,
    notify_internal: input.notify_internal,
    sync_quickbooks: input.sync_quickbooks,
  }
  const planned = await createAiStyleBooking({
    ...bookingInput,
    preview_only: true,
  })
  if (!planned.ok) throw new Error(planned.error)

  const requiredScopes = [
    'business:write',
    'finance:write',
    ...(input.notify_customer ? ['customer:contact'] : []),
  ]
  return storePreview({
    actor,
    actionType: 'appointment.create',
    requiredScope: 'business:write',
    idempotencyKey: input.idempotency_key,
    payload: {
      booking: {
        customer: bookingInput.customer,
        address: bookingInput.address,
        appointment_date: bookingInput.appointment_date,
        start_time: bookingInput.start_time,
        line_items: bookingInput.line_items,
        booking_mode: bookingInput.booking_mode,
        booking_channel: bookingInput.booking_channel,
        source_label: bookingInput.source_label,
        lead_source: bookingInput.lead_source,
        lead_source_detail: bookingInput.lead_source_detail,
        actor_label: bookingInput.actor_label,
        admin_heading: bookingInput.admin_heading,
        accepted_minimum_charge: bookingInput.accepted_minimum_charge,
        assigned_staff_user_id: bookingInput.assigned_staff_user_id,
        notify_customer: bookingInput.notify_customer,
        notify_internal: bookingInput.notify_internal,
        sync_quickbooks: bookingInput.sync_quickbooks,
      },
      expected_plan: planned,
      required_scopes: requiredScopes,
    },
    preview: {
      action: 'Book service appointment',
      customer: bookingInput.customer,
      address: bookingInput.address,
      schedule: {
        date: planned.appointment_date,
        start_time: planned.start_time,
        end_time: planned.end_time,
        technician_id: planned.assigned_staff_user_id,
        technician_name: planned.technician_name,
      },
      line_items: planned.line_items,
      subtotal: planned.subtotal,
      discount: planned.discount_applied,
      total: planned.total,
      effects: [
        'Creates or reuses the customer and service address.',
        'Creates a booked service appointment and draft invoice.',
        planned.side_effects.quickbooks_sync
          ? 'Queues and attempts the existing QuickBooks synchronization.'
          : 'Does not synchronize QuickBooks.',
        planned.side_effects.customer_notification
          ? 'Immediately runs the existing customer booking confirmation workflow.'
          : 'Does not contact the customer.',
        planned.side_effects.internal_notifications
          ? 'Sends the existing staff SMS, push, Telegram, and reminder notifications.'
          : 'Does not send internal booking notifications.',
      ],
    },
    supabase,
  })
}

export async function previewAppointmentUpdate(
  input: {
    appointment_id: string
    appointment_date?: string
    start_time?: string
    assigned_staff_user_id?: string | null
    internal_notes?: string | null
    cancel?: boolean
    park_on_cancel?: boolean
    notify_customer?: boolean
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  if (input.notify_customer) {
    throw new Error(
      'Customer notification is not enabled for MCP appointment changes yet; preview again with notify_customer=false',
    )
  }
  const supabase = client(supplied)
  const { data: appointment, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, kind, customer_id, appointment_date, start_time, end_time, status, assigned_staff_user_id, internal_notes, updated_at, ops_customers!ops_appointments_customer_id_fkey(full_name, first_name, phone, email, email_opt_out), ops_service_addresses(street_1, city, state, zip_code)',
    )
    .eq('id', input.appointment_id)
    .maybeSingle()
  if (error) throw error
  if (!appointment || appointment.kind === 'estimate') {
    throw new Error('Service appointment not found')
  }
  const next = {
    appointment_date: input.appointment_date || appointment.appointment_date,
    start_time: input.start_time || String(appointment.start_time).slice(0, 5),
    assigned_staff_user_id:
      input.assigned_staff_user_id === undefined
        ? appointment.assigned_staff_user_id
        : input.assigned_staff_user_id,
    internal_notes:
      input.internal_notes === undefined
        ? appointment.internal_notes
        : input.internal_notes,
    status: input.cancel ? 'cancelled' : appointment.status,
  }
  const scheduleChanged =
    next.appointment_date !== appointment.appointment_date ||
    next.start_time !== String(appointment.start_time).slice(0, 5) ||
    next.assigned_staff_user_id !== appointment.assigned_staff_user_id
  const customer = one(appointment.ops_customers)
  const address = one(appointment.ops_service_addresses)
  return storePreview({
    actor,
    actionType: 'appointment.update',
    requiredScope: 'business:write',
    idempotencyKey: input.idempotency_key,
    payload: {
      appointment_id: input.appointment_id,
      ...next,
      cancel: Boolean(input.cancel),
      park_on_cancel: input.park_on_cancel !== false,
      notify_customer: Boolean(input.notify_customer),
      expected_updated_at: appointment.updated_at,
    },
    preview: {
      action: input.cancel
        ? 'Cancel appointment'
        : scheduleChanged
          ? 'Reschedule or reassign appointment'
          : 'Update appointment notes',
      appointment_id: appointment.id,
      customer,
      address,
      before: {
        appointment_date: appointment.appointment_date,
        start_time: appointment.start_time,
        end_time: appointment.end_time,
        assigned_staff_user_id: appointment.assigned_staff_user_id,
        status: appointment.status,
        internal_notes: appointment.internal_notes,
      },
      after: next,
      effects: input.cancel
        ? [
            input.park_on_cancel === false
              ? 'Marks the appointment cancelled and leaves the cancelled block on the calendar.'
              : 'Marks the appointment cancelled and parks it off the calendar for possible rebooking.',
            input.notify_customer
              ? `Immediately sends the existing cancellation SMS/email workflow to ${customer?.phone || customer?.email || 'the customer contact on file'}.`
              : 'Does not notify the customer.',
          ]
        : [
            scheduleChanged
              ? 'Rechecks the selected technician/time against the live staff calendar before writing.'
              : 'Does not change the calendar.',
            input.notify_customer && scheduleChanged
              ? 'Immediately runs the existing job-rescheduled customer communication templates after the change.'
              : 'Does not notify the customer.',
          ],
    },
    supabase,
  })
}

export async function previewEstimateSave(
  input: {
    estimate_id?: string
    customer_id?: string
    service_address_id?: string
    appointment_date?: string
    start_time?: string
    end_time?: string
    assigned_staff_user_id?: string | null
    internal_notes?: string | null
    line_items?: Array<{
      service_id?: string | null
      description: string
      quantity: number
      unit_price: number
    }>
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  const supabase = client(supplied)
  const existing = input.estimate_id
    ? await supabase
        .from('ops_appointments')
        .select(
          'id, kind, customer_id, service_address_id, appointment_date, start_time, end_time, assigned_staff_user_id, internal_notes, estimate_status, quoted_total, updated_at, ops_appointment_line_items(id, service_catalog_item_id, name_snapshot, quantity, unit_price, line_total)',
        )
        .eq('id', input.estimate_id)
        .eq('kind', 'estimate')
        .maybeSingle()
    : { data: null, error: null }
  if (existing.error) throw existing.error
  if (input.estimate_id && !existing.data) throw new Error('Estimate not found')
  if (!input.estimate_id && (!input.customer_id || !input.service_address_id)) {
    throw new Error(
      'customer_id and service_address_id are required for a new estimate',
    )
  }
  const customerId = input.customer_id || existing.data?.customer_id
  const addressId =
    input.service_address_id || existing.data?.service_address_id
  if (!customerId || !addressId) {
    throw new Error('Estimate customer and service address are required')
  }
  const [{ data: customer, error: customerError }, addressResult] =
    await Promise.all([
      supabase
        .from('ops_customers')
        .select('id, full_name, business_name, email, phone')
        .eq('id', customerId)
        .maybeSingle(),
      supabase
        .from('ops_service_addresses')
        .select('id, customer_id, street_1, city, state, zip_code')
        .eq('id', addressId)
        .eq('customer_id', customerId)
        .maybeSingle(),
    ])
  if (customerError) throw customerError
  if (addressResult.error) throw addressResult.error
  if (!customer) throw new Error('Estimate customer not found')
  if (!addressResult.data) {
    throw new Error('Estimate service address does not belong to the customer')
  }
  if (!input.estimate_id && !input.assigned_staff_user_id) {
    throw new Error('assigned_staff_user_id is required for a new estimate')
  }
  const serviceIds = (input.line_items || [])
    .map((line) => line.service_id)
    .filter((id): id is string => Boolean(id))
  if (serviceIds.length > 0) {
    const { data: services, error: serviceError } = await supabase
      .from('service_catalog_items')
      .select('id')
      .in('id', serviceIds)
      .eq('is_active', true)
    if (serviceError) throw serviceError
    if (
      new Set((services || []).map((service) => service.id)).size !==
      new Set(serviceIds).size
    ) {
      throw new Error(
        'Every estimate service must reference an active catalog item',
      )
    }
  }
  const lines =
    input.line_items || existing.data?.ops_appointment_line_items || []
  const total = lines.reduce(
    (sum, line) =>
      sum + Number(line.quantity || 0) * Number(line.unit_price || 0),
    0,
  )
  const payload = {
    estimate_id: input.estimate_id || null,
    customer_id: customerId,
    service_address_id: addressId,
    appointment_date: input.appointment_date || existing.data?.appointment_date,
    start_time: input.start_time || existing.data?.start_time,
    end_time: input.end_time || existing.data?.end_time,
    assigned_staff_user_id:
      input.assigned_staff_user_id === undefined
        ? existing.data?.assigned_staff_user_id || null
        : input.assigned_staff_user_id,
    internal_notes:
      input.internal_notes === undefined
        ? existing.data?.internal_notes || null
        : input.internal_notes,
    line_items: input.line_items || null,
    quoted_total: Number(total.toFixed(2)),
    expected_updated_at: existing.data?.updated_at || null,
    schedule_changed:
      !existing.data ||
      input.appointment_date !== undefined ||
      input.start_time !== undefined ||
      input.end_time !== undefined ||
      input.assigned_staff_user_id !== undefined,
  }
  return storePreview({
    actor,
    actionType: 'estimate.save',
    requiredScope: 'estimates:write',
    idempotencyKey: input.idempotency_key,
    payload,
    preview: {
      action: input.estimate_id
        ? 'Revise saved estimate'
        : 'Create draft estimate',
      estimate_id: input.estimate_id || null,
      customer,
      address: addressResult.data,
      before: existing.data,
      after: payload,
      effects: [
        'Writes a draft estimate and its line items in Sightings.',
        'Does not email, text, accept, convert, or book the estimate.',
        'Does not create or publish an invoice.',
      ],
    },
    supabase,
  })
}

export async function previewEstimateDecision(
  input: {
    estimate_id: string
    decision: 'accepted' | 'declined'
    reason?: string | null
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  const supabase = client(supplied)
  const { data: estimate, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, kind, estimate_status, converted_appointment_id, quoted_total, updated_at, ops_customers!ops_appointments_customer_id_fkey(id, full_name, business_name), ops_service_addresses(street_1, city, state, zip_code)',
    )
    .eq('id', input.estimate_id)
    .eq('kind', 'estimate')
    .maybeSingle()
  if (error) throw error
  if (!estimate) throw new Error('Estimate not found')
  if (
    estimate.converted_appointment_id ||
    estimate.estimate_status === 'converted'
  ) {
    throw new Error('A converted estimate cannot be accepted or declined')
  }
  const previousStatus = estimate.estimate_status || 'draft'
  return storePreview({
    actor,
    actionType: 'estimate.decision',
    requiredScope: 'estimates:write',
    idempotencyKey: input.idempotency_key,
    payload: {
      estimate_id: input.estimate_id,
      decision: input.decision,
      reason: input.reason || null,
      expected_status: previousStatus,
      expected_updated_at: estimate.updated_at,
    },
    preview: {
      action: `Mark estimate ${input.decision}`,
      estimate_id: input.estimate_id,
      customer: one(estimate.ops_customers),
      address: one(estimate.ops_service_addresses),
      quoted_total: Number(estimate.quoted_total || 0),
      before: { estimate_status: previousStatus },
      after: { estimate_status: input.decision },
      reason: input.reason || null,
      effects: [
        `Marks this saved estimate ${input.decision}.`,
        'Records the confirmed status transition in Sightings history.',
        'Does not contact the customer or owner.',
        'Does not book work, convert the estimate, or create an invoice.',
      ],
    },
    supabase,
  })
}

export async function previewEstimateSend(
  input: {
    estimate_id: string
    reopen: boolean
    reason?: string | null
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  requireScope(actor, 'estimates:write')
  requireScope(actor, 'customer:contact')
  const supabase = client(supplied)
  const decisionExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60_000,
  ).toISOString()
  const prepared = await prepareEstimateQuote({
    supabase,
    estimateId: input.estimate_id,
    publicOrigin: APP_ORIGIN,
    decisionExpiresAt,
  })
  if (prepared.needs_reopen && !input.reopen) {
    throw new Error(
      'This estimate was already accepted or declined; set reopen=true and give a reason to request a new decision',
    )
  }
  if (
    prepared.needs_reopen &&
    (!input.reason?.trim() || input.reason.trim().length > 1000)
  ) {
    throw new Error('A reopen reason of 1-1000 characters is required')
  }
  const providerIdempotencyKey = `mcp-estimate-quote/${createHash('sha256')
    .update(`${input.estimate_id}:${input.idempotency_key}`)
    .digest('hex')}`
  return storePreview({
    actor,
    actionType: 'estimate.send',
    requiredScope: 'customer:contact',
    idempotencyKey: input.idempotency_key,
    payload: {
      estimate_id: input.estimate_id,
      reopen: input.reopen,
      reason: input.reason?.trim() || null,
      decision_expires_at: decisionExpiresAt,
      expected_email: prepared.recipient.toLowerCase(),
      expected_total: prepared.total,
      expected_status: prepared.previous_status,
      expected_updated_at: prepared.estimate_updated_at,
      expected_fingerprint: prepared.preview_fingerprint,
      provider_idempotency_key: providerIdempotencyKey,
      required_scopes: ['estimates:write', 'customer:contact'],
    },
    preview: {
      action: prepared.needs_reopen
        ? 'Reopen and send estimate email'
        : 'Send estimate email',
      estimate_id: input.estimate_id,
      to: prepared.recipient,
      subject: prepared.subject,
      body_text: prepared.body_text,
      total: prepared.total,
      current_status: prepared.previous_status,
      reopen_reason: input.reason?.trim() || null,
      decision_link_expires_at: decisionExpiresAt,
      preview_fingerprint: prepared.preview_fingerprint,
      effects: [
        'Immediately sends this exact estimate email through Resend.',
        'Includes the existing signed customer accept link with a 30-day expiration.',
        'Marks the estimate sent after provider acceptance and records email/status history when possible.',
        'Does not book work, convert the estimate, publish an invoice, or collect payment.',
      ],
    },
    supabase,
  })
}

export async function previewEstimateConversion(
  input: {
    estimate_id: string
    appointment_date: string
    start_time: string
    end_time?: string | null
    assigned_staff_user_id: string
    discount_amount: number
    notify_customer: boolean
    sync_quickbooks: boolean
    idempotency_key: string
  },
  actor: McpActor,
  supplied?: Db,
) {
  requireScope(actor, 'estimates:write')
  requireScope(actor, 'business:write')
  requireScope(actor, 'finance:write')
  if (input.notify_customer) requireScope(actor, 'customer:contact')
  const supabase = client(supplied)
  const prepared = await prepareEstimateConversion({
    supabase,
    estimateId: input.estimate_id,
    appointmentDate: input.appointment_date,
    startTime: input.start_time,
    endTime: input.end_time,
    assignedStaffUserId: input.assigned_staff_user_id,
    discountAmount: input.discount_amount,
    allowConflict: false,
    notifyCustomer: input.notify_customer,
    syncQuickBooks: input.sync_quickbooks,
  })
  const requiredScopes = [
    'estimates:write',
    'business:write',
    'finance:write',
    ...(input.notify_customer ? ['customer:contact'] : []),
  ]
  return storePreview({
    actor,
    actionType: 'estimate.convert',
    requiredScope: 'business:write',
    idempotencyKey: input.idempotency_key,
    payload: {
      prepared,
      notify_customer: input.notify_customer,
      sync_quickbooks: input.sync_quickbooks,
      required_scopes: requiredScopes,
    },
    preview: {
      action: 'Convert estimate to booked work',
      estimate_id: prepared.estimate_id,
      customer: prepared.customer,
      address: prepared.address,
      technician: {
        id: prepared.assigned_staff_user_id,
        name: prepared.technician_name,
      },
      time_window: {
        date: prepared.appointment_date,
        start_time: prepared.start_time,
        end_time: prepared.end_time,
        timezone: 'America/Denver',
      },
      line_items: prepared.line_items,
      subtotal: prepared.subtotal,
      discount_amount: prepared.discount_amount,
      total: prepared.total,
      current_estimate_status: prepared.expected_status,
      notify_customer: input.notify_customer,
      sync_quickbooks: input.sync_quickbooks,
      preview_fingerprint: prepared.preview_fingerprint,
      effects: [
        'Atomically creates one booked service appointment, copied line items, one draft invoice, invoice lines, and status history.',
        'Marks the source estimate converted only if every core database write succeeds.',
        input.notify_customer
          ? 'After the database commit, runs the existing scheduled-job communication workflow; delivery may contact the customer and staff according to current templates and preferences.'
          : 'Does not contact the customer or staff.',
        input.sync_quickbooks
          ? 'After the database commit, queues/synchronizes the created customer, appointment, and invoice with the existing QuickBooks workflow.'
          : 'Does not request QuickBooks synchronization.',
        'Does not publish or collect payment for the draft invoice.',
      ],
    },
    supabase,
  })
}

async function executeCustomerUpdate(
  payload: Record<string, any>,
  supabase: Db,
) {
  const { data: current, error: currentError } = await supabase
    .from('ops_customers')
    .select('id, phone, full_name, business_name, updated_at')
    .eq('id', payload.customer_id)
    .maybeSingle()
  if (currentError) throw currentError
  if (!current) throw new Error('Customer not found')
  if (current.updated_at !== payload.expected_customer_updated_at) {
    throw new Error('Customer changed after preview; preview again')
  }
  const customerChanges = payload.customer || {}
  const updates: Record<string, unknown> = {}
  for (const key of [
    'first_name',
    'last_name',
    'full_name',
    'business_name',
    'email',
    'phone',
    'notes',
    'email_opt_out',
  ]) {
    if (Object.prototype.hasOwnProperty.call(customerChanges, key)) {
      updates[key] = customerChanges[key] === '' ? null : customerChanges[key]
    }
  }
  if (
    !Object.prototype.hasOwnProperty.call(customerChanges, 'full_name') &&
    (Object.prototype.hasOwnProperty.call(customerChanges, 'first_name') ||
      Object.prototype.hasOwnProperty.call(customerChanges, 'last_name'))
  ) {
    updates.full_name = [customerChanges.first_name, customerChanges.last_name]
      .filter(Boolean)
      .join(' ')
  }

  let blacklistUpdate: { id: string; phone: string; name: string } | undefined
  const blacklistProfileChanged = [
    'phone',
    'full_name',
    'first_name',
    'last_name',
    'business_name',
  ].some((key) => Object.prototype.hasOwnProperty.call(customerChanges, key))
  if (blacklistProfileChanged) {
    const oldPhone = normalizePhone(String(current.phone || ''))
    const { data: blacklistEntry, error: blacklistError } =
      oldPhone.length === 10
        ? await supabase
            .from('blacklist')
            .select('id')
            .eq('phone', oldPhone)
            .maybeSingle()
        : { data: null, error: null }
    if (blacklistError) throw blacklistError
    if (blacklistEntry) {
      const nextPhone = normalizePhone(
        String(
          customerChanges.phone !== undefined
            ? customerChanges.phone
            : current.phone || '',
        ),
      )
      if (nextPhone.length !== 10) {
        throw new Error('A blacklisted customer must keep a valid phone number')
      }
      if (nextPhone !== oldPhone) {
        const { data: conflict, error: conflictError } = await supabase
          .from('blacklist')
          .select('id')
          .eq('phone', nextPhone)
          .maybeSingle()
        if (conflictError) throw conflictError
        if (conflict && conflict.id !== blacklistEntry.id) {
          throw new Error('The new phone number is already blacklisted')
        }
      }
      blacklistUpdate = {
        id: blacklistEntry.id,
        phone: nextPhone,
        name: String(
          customerChanges.business_name ||
            customerChanges.full_name ||
            updates.full_name ||
            current.business_name ||
            current.full_name,
        ),
      }
    }
  }

  let addressId: string | null = null
  let addressChanges: Record<string, unknown> = {}
  let locationChanged = false
  if (payload.address?.id) {
    const { data: address, error: addressError } = await supabase
      .from('ops_service_addresses')
      .select('id, updated_at')
      .eq('id', payload.address.id)
      .eq('customer_id', payload.customer_id)
      .maybeSingle()
    if (addressError) throw addressError
    if (!address) throw new Error('Service address not found')
    if (address.updated_at !== payload.expected_address_updated_at) {
      throw new Error('Service address changed after preview; preview again')
    }
    addressId = address.id
    for (const key of [
      'label',
      'street_1',
      'street_2',
      'city',
      'state',
      'zip_code',
      'gate_code',
      'notes',
    ]) {
      if (Object.prototype.hasOwnProperty.call(payload.address, key)) {
        addressChanges[key] =
          payload.address[key] === '' ? null : payload.address[key]
      }
    }
    locationChanged = invalidateGeocodeForAddressUpdate(addressChanges)
  }

  const { data, error: atomicError } = await supabase.rpc(
    'mcp_update_customer',
    {
      p_customer_id: payload.customer_id,
      p_expected_customer_updated_at: payload.expected_customer_updated_at,
      p_customer_changes: updates,
      p_address_id: addressId,
      p_expected_address_updated_at:
        addressId && payload.expected_address_updated_at
          ? payload.expected_address_updated_at
          : null,
      p_address_changes: addressChanges,
      p_blacklist_id: blacklistUpdate?.id || null,
      p_blacklist_phone: blacklistUpdate?.phone || null,
      p_blacklist_name: blacklistUpdate?.name || null,
    },
  )
  if (atomicError) throw atomicError

  const warnings: string[] = []
  if (locationChanged && addressId) {
    try {
      await queueGeocodeForStoredAddress(supabase, addressId)
    } catch (geocodeError) {
      console.error(
        '[mcp/customer] post-commit geocode queue failed:',
        geocodeError,
      )
      warnings.push(
        'The customer/address update committed, but geocoding could not be queued. Do not repeat the update; requeue geocoding for the address.',
      )
    }
  }
  return {
    ...(data as Record<string, unknown>),
    updated: true,
    warnings,
  }
}

async function executeConversationSend(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('updated_at')
    .eq('id', payload.conversation_id)
    .maybeSingle()
  if (error) throw error
  if (!conversation) throw new Error('Conversation not found')
  if (conversation.updated_at !== payload.expected_updated_at) {
    throw new Error(
      'Conversation changed after preview; preview the reply again',
    )
  }
  return sendConversationReply({
    supabase,
    conversationId: payload.conversation_id,
    message: payload.body,
    mediaIds: payload.media_ids,
    sentBy: actor.label,
    telegramMirrorLabel: 'Harry',
  })
}

function clockMinutes(value: string) {
  const [hours, minutes] = String(value).split(':').map(Number)
  return hours * 60 + minutes
}

function addMinutes(value: string, minutes: number) {
  const total = clockMinutes(value) + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`
}

async function executeAppointmentCreate(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  for (const scope of payload.required_scopes || []) {
    requireScope(actor, String(scope))
  }
  const bookingInput: CreateAiStyleBookingInput = {
    ...payload.booking,
    supabase,
    actor_label: `MCP (${actor.label})`,
  }
  const planned = await createAiStyleBooking({
    ...bookingInput,
    preview_only: true,
  })
  if (!planned.ok) throw new Error(planned.error)
  if (
    !payload.expected_plan ||
    payloadHash(payload.expected_plan) !== payloadHash(planned)
  ) {
    throw new Error(
      'The technician, time, services, pricing, lead attribution, or effects changed after preview; preview again',
    )
  }

  const plan = {
    customer: bookingInput.customer,
    address: {
      ...bookingInput.address,
      town_slug: normalizeTown(bookingInput.address.city),
    },
    appointment_date: planned.appointment_date,
    start_time: planned.start_time,
    end_time: planned.end_time,
    assigned_staff_user_id: planned.assigned_staff_user_id,
    appointment_status: planned.appointment_status,
    subtotal: planned.subtotal,
    discount_applied: planned.discount_applied,
    total: planned.total,
    line_items: planned.line_items,
    lead_source: planned.lead_source,
    sync_status: bookingInput.sync_quickbooks
      ? getQuickBooksSyncStatus()
      : 'held',
  }
  const { data, error } = await supabase.rpc('mcp_create_appointment', {
    p_plan: plan,
    p_actor_user_id: actor.subject,
  })
  if (error) throw error
  const result = data as {
    customer_id: string
    address_id: string
    appointment_id: string
    invoice_id: string
    appointment_status: 'booked' | 'pending_approval'
    subtotal: number
    discount_applied: number
    total: number
  }
  const warnings: string[] = []
  const warn = (label: string, reason: unknown) => {
    console.error(`[mcp/appointment] ${label}:`, reason)
    warnings.push(label)
  }
  const fullName =
    `${bookingInput.customer.first_name} ${bookingInput.customer.last_name}`.trim()

  try {
    await queueGeocodeForStoredAddress(supabase, result.address_id)
  } catch (reason) {
    warn(
      'Appointment was created, but address geocoding could not be queued.',
      reason,
    )
  }
  try {
    await cancelReactivationForCustomer(result.customer_id, 'booked_job')
  } catch (reason) {
    warn(
      'Appointment was created, but reactivation suppression could not be updated.',
      reason,
    )
  }
  if (bookingInput.sync_quickbooks) {
    try {
      await ensureCustomerQuickBooksSyncJob(
        supabase as Parameters<typeof ensureCustomerQuickBooksSyncJob>[0],
        result.customer_id,
        buildQuickBooksCustomerPayload({
          customerId: result.customer_id,
          fullName,
          email: bookingInput.customer.email,
          phone: bookingInput.customer.phone,
          address: bookingInput.address,
        }),
      )
      if (result.appointment_status === 'booked') {
        await syncAppointmentToQuickBooks(result.appointment_id)
      }
    } catch (reason) {
      warn(
        'Appointment was created, but QuickBooks synchronization failed.',
        reason,
      )
    }
  }
  if (bookingInput.notify_customer && result.appointment_status === 'booked') {
    try {
      await sendOpsLifecycleCommunications({
        event: 'job_scheduled',
        appointmentId: result.appointment_id,
      })
    } catch (reason) {
      warn(
        'Appointment was created, but customer confirmation delivery failed.',
        reason,
      )
    }
  }
  if (bookingInput.notify_internal) {
    const serviceNames = planned.line_items.map((item) => item.name_snapshot)
    const statusLabel =
      result.appointment_status === 'pending_approval'
        ? ' (NEEDS APPROVAL)'
        : ''
    const dateWithYear = new Date(
      `${planned.appointment_date}T12:00:00`,
    ).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Denver',
    })
    const leadSource = [
      planned.lead_source.lead_source,
      planned.lead_source.lead_source_detail,
    ]
      .filter(Boolean)
      .join(' - ')
    const adminMessage = [
      `New MCP booking${statusLabel}!`,
      `${fullName} — $${Number(result.total).toFixed(2)}`,
      serviceNames.join(', '),
      `${bookingInput.address.street_1}, ${bookingInput.address.city}, ${bookingInput.address.state} ${bookingInput.address.zip_code}`,
      `${planned.appointment_date} at ${planned.start_time.slice(0, 5)}`,
      `Lead source: ${leadSource || 'Not captured'}`,
    ].join('\n')
    const settled = await Promise.allSettled([
      sendAdminSMS(adminMessage, 'new_booking'),
      sendOneSignalNotification({
        heading: `New MCP booking${statusLabel}`,
        content: `${fullName} — $${Number(result.total).toFixed(2)} · ${dateWithYear}`,
        data: { type: 'new_booking', appointment_id: result.appointment_id },
      }),
      sendBookingNotification({
        customerName: fullName,
        phone: bookingInput.customer.phone,
        appointmentDate: planned.appointment_date,
        startTime: planned.start_time.slice(0, 5),
        total: Number(result.total),
        leadSource: leadSource || 'Not captured',
        bookingMethod: 'Dot MCP (ai agent)',
        technicianSchedule: planned.technician_name,
        services: serviceNames,
      }),
    ])
    if (settled.some((entry) => entry.status === 'rejected')) {
      warnings.push(
        'Appointment was created, but one or more internal notifications failed.',
      )
    }
    if (result.appointment_status === 'booked') {
      try {
        scheduleJobReminder({
          appointmentDate: planned.appointment_date,
          startTime: planned.start_time.slice(0, 5),
          customerName: fullName,
          address: `${bookingInput.address.street_1}, ${bookingInput.address.city}, ${bookingInput.address.state} ${bookingInput.address.zip_code}`,
          appointmentId: result.appointment_id,
        })
      } catch (reason) {
        warn(
          'Appointment was created, but the internal reminder could not be scheduled.',
          reason,
        )
      }
    }
  }
  const confirmationNumber = `SC-${result.appointment_id.slice(0, 8).toUpperCase()}`
  return {
    appointment_id: result.appointment_id,
    invoice_id: result.invoice_id,
    customer_id: result.customer_id,
    address_id: result.address_id,
    confirmation_number: confirmationNumber,
    status: result.appointment_status,
    appointment_date: planned.appointment_date,
    start_time: planned.start_time,
    end_time: planned.end_time,
    subtotal: result.subtotal,
    discount_applied: result.discount_applied,
    total: result.total,
    customer_notification_requested: Boolean(payload.booking.notify_customer),
    internal_notifications_requested: Boolean(payload.booking.notify_internal),
    quickbooks_sync_requested: Boolean(payload.booking.sync_quickbooks),
    warning: warnings.join(' ') || null,
  }
}

async function executeAppointmentUpdate(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  const { data: current, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, kind, appointment_date, start_time, end_time, status, assigned_staff_user_id, updated_at',
    )
    .eq('id', payload.appointment_id)
    .maybeSingle()
  if (error) throw error
  if (!current || current.kind === 'estimate')
    throw new Error('Appointment not found')
  if (current.updated_at !== payload.expected_updated_at) {
    throw new Error('Appointment changed after preview; preview again')
  }

  const scheduleChanged =
    payload.appointment_date !== current.appointment_date ||
    String(payload.start_time).slice(0, 5) !==
      String(current.start_time).slice(0, 5) ||
    payload.assigned_staff_user_id !== current.assigned_staff_user_id
  const duration = Math.max(
    15,
    clockMinutes(current.end_time) - clockMinutes(current.start_time),
  )
  let staffId = payload.assigned_staff_user_id
  if (scheduleChanged && !payload.cancel) {
    const prioritized = staffId
      ? null
      : await getStaffPrioritizedSlots({
          supabase,
          date: payload.appointment_date,
          requiredMinutes: duration,
          maxResults: 96,
          excludeAppointmentId: current.id,
        })
    const slots = staffId
      ? await getSlotsForStaff({
          supabase,
          date: payload.appointment_date,
          requiredMinutes: duration,
          staffUserId: staffId,
          maxResults: 96,
          excludeAppointmentId: current.id,
        })
      : prioritized?.slots || []
    const match = slots.find(
      (slot) =>
        String(slot.start_time).slice(0, 5) ===
        String(payload.start_time).slice(0, 5),
    )
    if (!match)
      throw new Error('The selected technician/time is no longer available')
    staffId = staffId || prioritized?.staffUserId || null
  }

  const nextStatus = payload.cancel ? 'cancelled' : current.status
  const nextEnd = scheduleChanged
    ? addMinutes(String(payload.start_time).slice(0, 5), duration)
    : current.end_time
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('ops_appointments')
    .update({
      appointment_date: payload.appointment_date,
      start_time: `${String(payload.start_time).slice(0, 5)}:00`,
      end_time: nextEnd,
      assigned_staff_user_id: staffId || null,
      internal_notes: payload.internal_notes || null,
      status: nextStatus,
      ...(payload.cancel && payload.park_on_cancel ? { parked_at: now } : {}),
      updated_at: now,
    })
    .eq('id', payload.appointment_id)
    .select(
      'id, appointment_date, start_time, end_time, assigned_staff_user_id, status, updated_at',
    )
    .single()
  if (updateError) throw updateError
  let statusHistoryRecorded = true
  if (current.status !== nextStatus) {
    const { error: eventError } = await supabase
      .from('ops_appointment_status_events')
      .insert({
        appointment_id: current.id,
        from_status: current.status,
        to_status: nextStatus,
        changed_by: actor.subject,
        notes: `Appointment updated through MCP by ${actor.label}`,
      })
    if (eventError) {
      statusHistoryRecorded = false
      console.error(
        '[mcp/appointment] appointment changed but status history failed:',
        eventError,
      )
    }
  }
  return {
    appointment: updated,
    customer_notification_requested: false,
    customer_notification_sent: false,
    status_history_recorded: statusHistoryRecorded,
    warning: statusHistoryRecorded
      ? null
      : 'The appointment changed, but its status-history row could not be recorded. Do not repeat the appointment change just to repair history.',
  }
}

async function executeEstimateSave(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  const estimateId = payload.estimate_id as string | null
  const { data: address, error: addressError } = await supabase
    .from('ops_service_addresses')
    .select('id')
    .eq('id', payload.service_address_id)
    .eq('customer_id', payload.customer_id)
    .maybeSingle()
  if (addressError) throw addressError
  if (!address) {
    throw new Error(
      'Estimate service address no longer belongs to the customer',
    )
  }
  const executeServiceIds = (payload.line_items || [])
    .map((line: Record<string, unknown>) => line.service_id)
    .filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0,
    )
  if (executeServiceIds.length > 0) {
    const { data: services, error: serviceError } = await supabase
      .from('service_catalog_items')
      .select('id')
      .in('id', executeServiceIds)
      .eq('is_active', true)
    if (serviceError) throw serviceError
    if (
      new Set((services || []).map((service) => service.id)).size !==
      new Set(executeServiceIds).size
    ) {
      throw new Error('An estimate service is no longer active; preview again')
    }
  }
  if (payload.schedule_changed) {
    if (!payload.assigned_staff_user_id) {
      throw new Error('A scheduled estimate requires an assigned technician')
    }
    const start = String(payload.start_time).slice(0, 5)
    const end = String(payload.end_time).slice(0, 5)
    const requiredMinutes = clockMinutes(end) - clockMinutes(start)
    if (requiredMinutes < 15) {
      throw new Error(
        'Estimate end time must be at least 15 minutes after start',
      )
    }
    const slots = await getSlotsForStaff({
      supabase,
      date: payload.appointment_date,
      requiredMinutes,
      staffUserId: payload.assigned_staff_user_id,
      excludeAppointmentId: estimateId || undefined,
      maxResults: 96,
    })
    if (!slots.some((slot) => String(slot.start_time).slice(0, 5) === start)) {
      throw new Error('The estimate technician/time is no longer available')
    }
  }
  if (estimateId) {
    const { data: current, error } = await supabase
      .from('ops_appointments')
      .select('id, updated_at')
      .eq('id', estimateId)
      .eq('kind', 'estimate')
      .maybeSingle()
    if (error) throw error
    if (!current) throw new Error('Estimate not found')
    if (current.updated_at !== payload.expected_updated_at) {
      throw new Error('Estimate changed after preview; preview again')
    }
  }
  const { data, error } = await supabase.rpc('mcp_save_estimate', {
    p_estimate_id: estimateId,
    p_expected_updated_at: payload.expected_updated_at,
    p_payload: payload,
    p_actor_user_id: actor.subject,
  })
  if (error) throw error
  return data as Record<string, unknown>
}

async function executeEstimateDecision(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  const { data: current, error } = await supabase
    .from('ops_appointments')
    .select('id, estimate_status, converted_appointment_id, updated_at')
    .eq('id', payload.estimate_id)
    .eq('kind', 'estimate')
    .maybeSingle()
  if (error) throw error
  if (!current) throw new Error('Estimate not found')
  if (
    current.converted_appointment_id ||
    current.estimate_status === 'converted'
  ) {
    throw new Error('A converted estimate cannot be accepted or declined')
  }
  if (
    current.updated_at !== payload.expected_updated_at ||
    (current.estimate_status || 'draft') !== payload.expected_status
  ) {
    throw new Error('Estimate changed after preview; preview again')
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('ops_appointments')
    .update({ estimate_status: payload.decision, updated_at: now })
    .eq('id', payload.estimate_id)
    .eq('kind', 'estimate')
    .eq('updated_at', payload.expected_updated_at)
    .select('id, estimate_status, updated_at')
    .maybeSingle()
  if (updateError) throw updateError
  if (!updated) throw new Error('Estimate changed during execution; check it')

  const { error: eventError } = await supabase
    .from('ops_appointment_status_events')
    .insert({
      appointment_id: payload.estimate_id,
      from_status: payload.expected_status,
      to_status: payload.decision,
      changed_by: actor.subject,
      notes: payload.reason
        ? `Estimate marked ${payload.decision} through MCP by ${actor.label}. Reason: ${payload.reason}`
        : `Estimate marked ${payload.decision} through MCP by ${actor.label}`,
    })
  if (eventError) {
    console.error(
      '[mcp/estimate] estimate changed but status history failed:',
      eventError,
    )
  }
  return {
    estimate: updated,
    customer_contacted: false,
    owner_notified: false,
    status_history_recorded: !eventError,
    warning: eventError
      ? 'The estimate status changed, but its status-history row could not be recorded. Do not repeat the decision just to repair history.'
      : null,
  }
}

async function executeEstimateSend(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  for (const scope of payload.required_scopes || []) {
    requireScope(actor, String(scope))
  }
  const prepared = await prepareEstimateQuote({
    supabase,
    estimateId: payload.estimate_id,
    publicOrigin: APP_ORIGIN,
    decisionExpiresAt: payload.decision_expires_at,
  })
  if (
    prepared.recipient.toLowerCase() !== payload.expected_email ||
    prepared.total !== payload.expected_total ||
    prepared.previous_status !== payload.expected_status ||
    prepared.estimate_updated_at !== payload.expected_updated_at ||
    prepared.preview_fingerprint !== payload.expected_fingerprint
  ) {
    throw new Error(
      'The recipient, status, pricing, line items, notes, or email language changed after preview; preview again',
    )
  }
  return deliverPreparedEstimateQuote({
    supabase,
    prepared,
    actorId: actor.subject,
    reopen: Boolean(payload.reopen),
    reason: payload.reason,
    providerIdempotencyKey: payload.provider_idempotency_key,
  })
}

async function executeEstimateConversion(
  payload: Record<string, any>,
  actor: McpActor,
  supabase: Db,
) {
  for (const scope of payload.required_scopes || []) {
    requireScope(actor, String(scope))
  }
  return executeAtomicEstimateConversion({
    supabase,
    prepared: payload.prepared as PreparedEstimateConversion,
    actorId: actor.subject,
    allowConflict: false,
    notifyCustomer: Boolean(payload.notify_customer),
    syncQuickBooks: Boolean(payload.sync_quickbooks),
  })
}

export async function executePreparedAction(
  input: {
    confirmation_id: string
    confirmed: true
    expected_action_type?: ActionType
  },
  actor: McpActor,
  supplied?: Db,
) {
  const supabase = client(supplied)
  const { data: action, error } = await supabase
    .from('mcp_action_previews')
    .select('*')
    .eq('id', input.confirmation_id)
    .eq('actor_user_id', actor.subject)
    .maybeSingle()
  if (error) throw error
  if (!action) throw new Error('Confirmation not found')
  if (
    input.expected_action_type &&
    action.action_type !== input.expected_action_type
  ) {
    throw new Error('Confirmation belongs to a different action tool')
  }
  requireScope(actor, action.required_scope)
  if (action.status === 'executed') return action.result
  if (action.status !== 'pending') {
    throw new Error(
      `Confirmation is ${action.status}; preview the action again`,
    )
  }
  if (new Date(action.expires_at).getTime() <= Date.now()) {
    await supabase
      .from('mcp_action_previews')
      .update({ status: 'expired', action_payload: {}, preview: {} })
      .eq('id', action.id)
    throw new Error('Confirmation expired; preview the action again')
  }
  if (payloadHash(action.action_payload) !== action.payload_hash) {
    throw new Error('Confirmation payload failed its integrity check')
  }
  const { data: claimed, error: claimError } = await supabase
    .from('mcp_action_previews')
    .update({ status: 'executing' })
    .eq('id', action.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (claimError) throw claimError
  if (!claimed) throw new Error('Action is already executing')

  let result: Record<string, unknown>
  try {
    if (action.action_type === 'customer.update') {
      result = await executeCustomerUpdate(action.action_payload, supabase)
    } else if (action.action_type === 'conversation.send') {
      result = await executeConversationSend(
        action.action_payload,
        actor,
        supabase,
      )
    } else if (action.action_type === 'appointment.create') {
      result = await executeAppointmentCreate(
        action.action_payload,
        actor,
        supabase,
      )
    } else if (action.action_type === 'appointment.update') {
      result = await executeAppointmentUpdate(
        action.action_payload,
        actor,
        supabase,
      )
    } else if (action.action_type === 'estimate.save') {
      result = await executeEstimateSave(action.action_payload, actor, supabase)
    } else if (action.action_type === 'estimate.decision') {
      result = await executeEstimateDecision(
        action.action_payload,
        actor,
        supabase,
      )
    } else if (action.action_type === 'estimate.send') {
      result = await executeEstimateSend(action.action_payload, actor, supabase)
    } else if (action.action_type === 'estimate.convert') {
      result = await executeEstimateConversion(
        action.action_payload,
        actor,
        supabase,
      )
    } else {
      throw new Error(`Unsupported action type: ${action.action_type}`)
    }
  } catch (executionError) {
    const message =
      executionError instanceof Error ? executionError.message : 'Action failed'
    await supabase
      .from('mcp_action_previews')
      .update({
        status: 'failed',
        error_message: message,
        action_payload: {},
        preview: {},
      })
      .eq('id', action.id)
    await supabase.from('mcp_action_audit').insert({
      actor_user_id: actor.subject,
      preview_id: action.id,
      action_type: action.action_type,
      status: 'failed',
      payload_hash: action.payload_hash,
      result: { error: message },
    })
    throw executionError
  }

  const { error: auditError } = await supabase.from('mcp_action_audit').insert({
    actor_user_id: actor.subject,
    preview_id: action.id,
    action_type: action.action_type,
    status: 'executed',
    payload_hash: action.payload_hash,
    result,
  })
  const finalResult = auditError
    ? {
        ...result,
        audit_warning:
          'The business action completed, but the secondary audit row could not be written. The confirmation record remains the execution record.',
      }
    : result
  if (auditError) {
    console.error('[mcp/action] secondary audit insert failed:', auditError)
  }
  const executedAt = new Date().toISOString()
  const { error: finishError } = await supabase
    .from('mcp_action_previews')
    .update({
      status: 'executed',
      executed_at: executedAt,
      result: finalResult,
      action_payload: {},
      preview: {},
    })
    .eq('id', action.id)
  if (finishError) {
    console.error(
      '[mcp/action] action completed but confirmation finalization failed:',
      finishError,
    )
    throw new Error(
      'The business action completed, but its confirmation record could not be finalized. Do not retry; inspect the action audit first.',
    )
  }
  return finalResult
}
