import type { SupabaseClient } from '@supabase/supabase-js'
import type OpenAI from 'openai'
import {
  applyAppointmentBuffer,
  calendarEventsToAppointmentWindows,
  calculateLineItemDurationMinutes,
  DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES,
  getAvailableSlots,
  type ExistingAppointmentWindow,
} from '@/lib/ops/availability'
import {
  createAiStyleBooking,
  GOOGLE_LSA_LEAD_RECOVERY_AMOUNT,
} from '@/lib/ops/create-ai-style-booking'
import { createAiStyleEstimate } from '@/lib/ops/create-ai-style-estimate'
import { createSlotToken, verifySlotToken } from '@/lib/ops/slot-token'
import { resyncInvoiceToQuickBooks } from '@/lib/quickbooks-api'
import { sendAdminSMS, sendCustomerSMS } from '@/lib/twilio'
import { sendToCharles } from '@/lib/harry-command-bot'

/** Today's date in Mountain Time (YYYY-MM-DD). Avoids UTC rollover at 6 PM MDT. */
function todayMountain(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
}

const UPCOMING_STATUSES = [
  'booked',
  'confirmed',
  'on_my_way',
  'in_progress',
  'pending_approval',
] as const

const TOOL_RATE_WINDOW_MS = 60_000
const TOOL_RATE_MAX = 20
const toolCallTimestamps = new Map<string, number[]>()
const ISSUE_REPORT_WINDOW_MS = 10 * 60_000
const issueReportTimestamps = new Map<string, number>()

function checkToolRate(
  phone: string,
): { ok: true } | { ok: false; error: string } {
  const now = Date.now()
  const windowStart = now - TOOL_RATE_WINDOW_MS
  let stamps = toolCallTimestamps.get(phone) ?? []
  stamps = stamps.filter((t) => t > windowStart)
  if (stamps.length >= TOOL_RATE_MAX) {
    return {
      ok: false,
      error: 'Too many actions in a short time. Try again in a minute.',
    }
  }
  stamps.push(now)
  toolCallTimestamps.set(phone, stamps)
  return { ok: true }
}

export function phoneSearchVariants(e164: string): string[] {
  const trimmed = e164.trim()
  const digits = trimmed.replace(/\D/g, '')
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits
  const out = new Set<string>()
  if (trimmed) out.add(trimmed)
  if (last10.length === 10) {
    out.add(`+1${last10}`)
    out.add(`+${last10}`)
    out.add(last10)
  }
  return [...out]
}

function last10Digits(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

function phoneMatchesInbound(
  inbound: string,
  dbPhone: string | null | undefined,
): boolean {
  if (!dbPhone) return false
  const a = last10Digits(inbound)
  const b = last10Digits(dbPhone)
  return a.length === 10 && b.length === 10 && a === b
}

type SmsCustomerProfile = {
  id: string
  first_name: string | null
  full_name: string | null
  business_name: string | null
  email: string | null
  phone: string | null
  addresses: Array<{
    street_1: string | null
    city: string | null
    state: string | null
    zip_code: string | null
  }>
}

type SmsConversationProfile = {
  id: string
  source: string | null
  status: string | null
  customer_name: string | null
  inferred_name: string | null
  inferred_email: string | null
  last_customer_message: string | null
  updated_at: string | null
}

function conversationMessageRecords(
  messages: unknown,
): Array<{ role: string; content: string }> {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return []
    const record = message as { role?: unknown; content?: unknown }
    const content =
      typeof record.content === 'string'
        ? record.content.replace(/\s+/g, ' ').trim()
        : ''
    if (!content) return []
    return [
      {
        role: typeof record.role === 'string' ? record.role : 'unknown',
        content,
      },
    ]
  })
}

function inferIdentityFromConversation(messages: unknown): {
  name: string | null
  email: string | null
  lastCustomerMessage: string | null
} {
  const userMessages = conversationMessageRecords(messages).filter(
    (message) => message.role === 'user',
  )
  const joined = userMessages.map((message) => message.content).join(' ')
  const lastCustomerMessage =
    userMessages[userMessages.length - 1]?.content?.slice(0, 240) || null

  const email =
    joined.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)?.[0] ||
    null

  const namePatterns = [
    /(?:my name is|i'm|this is|it's|i am|name's|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /\bname\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
  ]
  const falsePositives = new Set([
    'hi',
    'hello',
    'hey',
    'yes',
    'no',
    'sure',
    'thanks',
    'great',
    'ok',
    'okay',
    'woodland park',
    'colorado springs',
    'castle rock',
  ])

  let name: string | null = null
  for (const pattern of namePatterns) {
    const match = joined.match(pattern)
    const candidate = match?.[1]?.trim()
    if (candidate && !falsePositives.has(candidate.toLowerCase())) {
      name = candidate
      break
    }
  }

  return { name, email, lastCustomerMessage }
}

async function lookupSmsCustomerProfiles(
  supabase: SupabaseClient,
  phone: string,
): Promise<SmsCustomerProfile[]> {
  const variants = phoneSearchVariants(phone)
  let customers: Array<{
    id: string
    first_name: string | null
    full_name: string | null
    business_name: string | null
    email: string | null
    phone: string | null
  }> | null = null

  const selectFields = 'id, first_name, full_name, business_name, email, phone'

  if (variants.length > 0) {
    const { data, error } = await supabase
      .from('ops_customers')
      .select(selectFields)
      .in('phone', variants)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(5)

    if (error) throw error
    customers = data
  }

  if (!customers?.length) {
    const last10 = last10Digits(phone)
    if (last10.length === 10) {
      const { data, error } = await supabase
        .from('ops_customers')
        .select(selectFields)
        .ilike('phone', `%${last10}`)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(10)

      if (error) throw error
      customers = (data || []).filter((customer) =>
        phoneMatchesInbound(phone, customer.phone),
      )
    }
  }

  if (!customers?.length) return []

  const customerIds = customers.map((customer) => customer.id)
  const { data: addressRows, error: addressError } = await supabase
    .from('ops_service_addresses')
    .select('customer_id, street_1, city, state, zip_code')
    .in('customer_id', customerIds)
    .order('updated_at', { ascending: false, nullsFirst: false })

  if (addressError) throw addressError

  const addressesByCustomer = new Map<string, SmsCustomerProfile['addresses']>()
  for (const row of addressRows || []) {
    const customerId = String(row.customer_id || '')
    if (!customerId) continue
    const addresses = addressesByCustomer.get(customerId) || []
    addresses.push({
      street_1: row.street_1,
      city: row.city,
      state: row.state,
      zip_code: row.zip_code,
    })
    addressesByCustomer.set(customerId, addresses)
  }

  return customers.map((customer) => ({
    ...customer,
    addresses: addressesByCustomer.get(customer.id)?.slice(0, 3) || [],
  }))
}

async function lookupSmsConversationProfiles(
  supabase: SupabaseClient,
  phone: string,
): Promise<SmsConversationProfile[]> {
  const variants = phoneSearchVariants(phone)
  let conversations: Array<{
    id: string
    phone_number: string | null
    source: string | null
    status: string | null
    messages: unknown
    updated_at: string | null
  }> | null = null

  const selectFields = 'id, phone_number, source, status, messages, updated_at'
  if (variants.length > 0) {
    const { data, error } = await supabase
      .from('conversations')
      .select(selectFields)
      .in('phone_number', variants)
      .order('updated_at', { ascending: false })
      .limit(5)

    if (error) throw error
    conversations = data
  }

  if (!conversations?.length) {
    const last10 = last10Digits(phone)
    if (last10.length === 10) {
      const { data, error } = await supabase
        .from('conversations')
        .select(selectFields)
        .ilike('phone_number', `%${last10}`)
        .order('updated_at', { ascending: false })
        .limit(10)

      if (error) throw error
      conversations = (data || []).filter((conversation) =>
        phoneMatchesInbound(phone, conversation.phone_number),
      )
    }
  }

  return (conversations || []).map((conversation) => {
    const inferred = inferIdentityFromConversation(conversation.messages)
    return {
      id: conversation.id,
      source: conversation.source,
      status: conversation.status,
      customer_name: null as string | null,
      inferred_name: inferred.name,
      inferred_email: inferred.email,
      last_customer_message: inferred.lastCustomerMessage,
      updated_at: conversation.updated_at,
    }
  })
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

function addMinutesToTime(value: string, minutesToAdd: number): string {
  const [hours, minutes] = value.split(':').map(Number)
  const total = hours * 60 + minutes + minutesToAdd
  const normalized = ((total % 1440) + 1440) % 1440
  const nextHours = Math.floor(normalized / 60)
  const nextMinutes = normalized % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:00`
}

function toDbTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim())
  if (!m) return '09:00:00'
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  const sec = m[3] != null ? Math.min(59, Math.max(0, parseInt(m[3], 10))) : 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function normClock5(t: string): string {
  return toDbTime(t).slice(0, 5)
}

async function loadAvailabilityBundle(
  supabase: SupabaseClient,
  date: string,
  excludeAppointmentId?: string,
): Promise<{
  templates: Parameters<typeof getAvailableSlots>[0]['templates']
  overrides: Parameters<typeof getAvailableSlots>[0]['overrides']
  appointments: ExistingAppointmentWindow[]
}> {
  const [templatesResult, overridesResult, appointmentsResult, eventsResult] =
    await Promise.all([
      supabase.from('availability_templates').select('*').eq('is_active', true),
      supabase
        .from('availability_overrides')
        .select('*')
        .eq('override_date', date),
      supabase
        .from('ops_appointments')
        .select('id, appointment_date, start_time, end_time, status')
        .eq('appointment_date', date),
      supabase
        .from('ops_calendar_events')
        .select(
          'event_kind, start_date, end_date, start_time, end_time, is_all_day',
        )
        .lte('start_date', date)
        .gte('end_date', date),
    ])

  // Self-heal: if no active templates exist, re-seed defaults so booking
  // keeps working and the issue is logged for investigation.
  let templates = templatesResult.data || []
  if (templates.length === 0) {
    console.warn(
      '⚠️  No active availability_templates found — auto-seeding defaults',
    )
    const defaults = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES.map((t) => ({
      day_of_week: t.day_of_week,
      start_time: t.start_time,
      end_time: t.end_time,
      slot_interval_minutes: t.slot_interval_minutes,
      is_active: true,
    }))
    const { data: seeded } = await supabase
      .from('availability_templates')
      .upsert(defaults, { onConflict: 'day_of_week' })
      .select('*')
    if (seeded && seeded.length > 0) templates = seeded
    else templates = DEFAULT_FALLBACK_AVAILABILITY_TEMPLATES as typeof templates
  }

  let rows = (appointmentsResult.data || []) as Array<
    ExistingAppointmentWindow & { id: string }
  >
  if (excludeAppointmentId) {
    rows = rows.filter((a) => a.id !== excludeAppointmentId)
  }
  return {
    templates,
    overrides: overridesResult.data || [],
    appointments: [
      ...rows.map(({ appointment_date, start_time, end_time, status }) => ({
        appointment_date,
        start_time,
        end_time,
        status,
      })),
      ...calendarEventsToAppointmentWindows(date, eventsResult.data || []),
    ],
  }
}

async function customerOwnsAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  inboundPhoneE164: string,
): Promise<
  | {
      ok: true
      appointment: {
        id: string
        customer_id: string
        service_address_id: string
        appointment_date: string
        start_time: string
        end_time: string
        status: string
        internal_notes: string | null
      }
      customerName: string | null
      customerPhone: string | null
    }
  | { ok: false; error: string }
> {
  const { data: row, error } = await supabase
    .from('ops_appointments')
    .select(
      `
      id,
      customer_id,
      service_address_id,
      appointment_date,
      start_time,
      end_time,
      status,
      internal_notes,
      ops_customers!ops_appointments_customer_id_fkey ( full_name, phone )
    `,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: 'Appointment not found.' }
  }

  const cust = row.ops_customers as {
    full_name?: string | null
    phone?: string | null
  } | null
  const customerName = cust?.full_name ?? null
  const customerPhone = cust?.phone ?? null
  if (!phoneMatchesInbound(inboundPhoneE164, customerPhone)) {
    return {
      ok: false,
      error:
        'That appointment is not linked to this phone number. Call the office if you need help.',
    }
  }

  return {
    ok: true,
    appointment: {
      id: row.id,
      customer_id: row.customer_id,
      service_address_id: row.service_address_id,
      appointment_date: row.appointment_date,
      start_time: row.start_time,
      end_time: row.end_time,
      status: row.status,
      internal_notes: row.internal_notes,
    },
    customerName,
    customerPhone,
  }
}

export type HarrySmsToolContext = {
  supabase: SupabaseClient
  customerPhoneE164: string
  isLsaRelay?: boolean
  sessionId?: string
}

export const HARRY_SMS_TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_customer_profile',
      description:
        'Look up the customer profile attached to this SMS phone number, including name, email, phone, and saved service addresses. CALL THIS FIRST at the start of every conversation before asking for any contact info. Also call when customer says "look me up", "my phone number", "you have my info", etc.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_my_upcoming_appointments',
      description:
        'List this customer\'s upcoming Ops jobs (matched by SMS phone). Also returns any matched customer profile even when there are no upcoming jobs. Use when they ask about "my appointment" or need an appointment_id.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_service_catalog',
      description:
        'Search active services by name to get service UUIDs for booking.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search text (e.g. carpet, upholstery)',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_slots',
      description:
        'Get available start times for a calendar date (YYYY-MM-DD) in America/Denver scheduling. Response includes day_of_week — always use that when telling the customer what day it is.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          duration_minutes: {
            type: 'number',
            description:
              'Total job duration in minutes before buffer (default 120)',
          },
        },
        required: ['date'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_job_address',
      description:
        'Update the service address on an existing upcoming job for this phone number.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: {
            type: 'string',
            description: 'Two-letter state, default CO',
          },
          zip_code: { type: 'string' },
        },
        required: ['appointment_id', 'street_1', 'city', 'zip_code'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reschedule_job',
      description:
        'Move an existing job to a new date and start time. First call list_my_upcoming_appointments and use its real appointment_id. Time must match an available slot from get_calendar_slots, and slot_token must be copied exactly from that slot.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          new_appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
          new_start_time: { type: 'string', description: 'HH:MM (24h)' },
          slot_token: {
            type: 'string',
            description:
              'Required. Use the slot_token returned by get_calendar_slots for this exact date and time.',
          },
        },
        required: [
          'appointment_id',
          'new_appointment_date',
          'new_start_time',
          'slot_token',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_job_line_items',
      description:
        'Replace the services/line items on an existing appointment. Use when the customer corrects job details after booking (wrong rooms, wrong services, wrong quantities). Recalculates price and duration.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string' },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                service_id: { type: 'string' },
                quantity: { type: 'number' },
              },
              required: ['service_id', 'quantity'],
            },
          },
        },
        required: ['appointment_id', 'line_items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_job_note',
      description:
        'Add or append important information to the internal notes field on an existing appointment. Use this when the customer provides access codes (garage codes, gate codes), special instructions, pet information, or other details that Charles needs to know when servicing the job. The note will be added to any existing notes.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: {
            type: 'string',
            description:
              'The appointment UUID from list_my_upcoming_appointments',
          },
          note: {
            type: 'string',
            description:
              'The information to save (e.g., "Garage code: 1234" or "Dog in backyard - use front door only")',
          },
        },
        required: ['appointment_id', 'note'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_new_job',
      description:
        "Create a new Ops appointment for this SMS customer. Requires name, email, full address, real service IDs returned by search_service_catalog, and a slot time that appears in get_calendar_slots for that date. Never invent service IDs. Phone is normally taken from SMS automatically. For Google LSA relay conversations ONLY, you MUST collect the customer's real callback number and pass it as customer_phone (the relay cannot receive texts).",
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          email: { type: 'string' },
          customer_phone: {
            type: 'string',
            description:
              "Customer's real callback phone number. Required ONLY for Google LSA leads - the relay number cannot receive confirmations. For regular inbound SMS, this is optional (phone taken from SMS automatically). Format: 10-digit US number.",
          },
          lead_source: {
            type: 'string',
            description:
              'How the customer heard about Sasquatch Carpet Cleaning. Always required — ask before booking if not already known. Examples: Google, Nextdoor, Facebook, Yelp, ChatGPT, Gemini, Claude, Grok, Perplexity, Saw truck/vehicle wrap, Word of mouth / Referral, Repeat customer, Google LSA, NFC Card, Other.',
          },
          accepted_minimum_charge: {
            type: 'boolean',
            description:
              'Set true only when the calculated services are below the $150 minimum and the customer explicitly agreed to pay the $150 minimum anyway.',
          },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          zip_code: { type: 'string' },
          appointment_date: { type: 'string' },
          start_time: { type: 'string' },
          slot_token: {
            type: 'string',
            description:
              'Required. Use the slot_token returned by get_calendar_slots for this exact date and time.',
          },
          line_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                service_id: { type: 'string' },
                quantity: { type: 'number' },
              },
              required: ['service_id', 'quantity'],
            },
          },
        },
        required: [
          'first_name',
          'last_name',
          'email',
          'lead_source',
          'street_1',
          'city',
          'zip_code',
          'appointment_date',
          'start_time',
          'slot_token',
          'line_items',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_commercial_estimate',
      description:
        "COMMERCIAL WORK ONLY. Book a 1-hour time slot on Charles's calendar for an on-site walkthrough / measurement visit of a commercial property (office, restaurant, HOA, church, apartment complex, school, medical office, gym, store, etc.). You are NOT generating the estimate — you are only reserving the slot for Charles to come out, measure, and build the quote himself. Requires a start_time that appears in get_calendar_slots for that date (use duration_minutes=60 when checking). DO NOT use this for any residential job — residential ALWAYS books directly via book_new_job, no matter how big or complex the house is.",
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          business_name: {
            type: 'string',
            description:
              'Company / business name (strongly preferred for commercial leads — e.g. "Gold Hill Mesa HOA", "Joe\'s Barbershop"). Leave empty if the contact is an individual.',
          },
          email: { type: 'string' },
          customer_phone: {
            type: 'string',
            description:
              "Customer's real callback phone (10-digit US). Required — for LSA relay conversations pass the customer's actual number, not the relay.",
          },
          street_1: { type: 'string' },
          city: { type: 'string' },
          state: {
            type: 'string',
            description: 'Two-letter state, defaults to CO',
          },
          zip_code: { type: 'string' },
          appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: 'string', description: 'HH:MM (24h)' },
          slot_token: {
            type: 'string',
            description:
              'Required. Use the slot_token returned by get_calendar_slots for this exact commercial walkthrough slot.',
          },
          job_description: {
            type: 'string',
            description:
              'Short summary of what they want quoted — square footage if known, floor types, occupancy, any photos shared, urgency, etc.',
          },
        },
        required: [
          'first_name',
          'last_name',
          'email',
          'customer_phone',
          'street_1',
          'city',
          'zip_code',
          'appointment_date',
          'start_time',
          'slot_token',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_operational_problem',
      description:
        "Safely escalate a real blocker to Charles with a concise diagnostic report. Use only after you tried the correct Ops tool flow and still cannot complete the customer's operational request, or for urgent customer/service issues. Do NOT use for ordinary missing customer info, normal minimum-charge conversations, unavailable time slots, or before retrying with corrected real IDs/tokens/services.",
      parameters: {
        type: 'object',
        properties: {
          blocker_type: {
            type: 'string',
            enum: [
              'tool_error_after_retry',
              'cannot_match_service',
              'cannot_match_appointment',
              'policy_conflict',
              'urgent_customer_issue',
              'missing_internal_capability',
            ],
            description:
              'The kind of blocker. Do not choose this for normal missing customer details.',
          },
          attempted_action: {
            type: 'string',
            description:
              'What you were trying to do, e.g. book job, reschedule, update address, update line items.',
          },
          customer_goal: {
            type: 'string',
            description: 'What the customer wants in plain language.',
          },
          known_details: {
            type: 'string',
            description:
              'Useful known details: quoted total, services, address, requested date/time, customer name/email if known.',
          },
          blocking_reason: {
            type: 'string',
            description:
              'The exact reason you cannot finish without help. Include the real failed tool name/error when applicable.',
          },
          last_tool_error: {
            type: 'string',
            description:
              'Most recent tool error text, or urgent issue details if no tool was appropriate.',
          },
          retry_attempted: {
            type: 'boolean',
            description:
              'True only if you already retried or corrected the issue using the proper lookup tools. Required except urgent_customer_issue.',
          },
          customer_waiting: {
            type: 'boolean',
            description:
              'Whether the customer is waiting for Harry/Charles to resolve this now.',
          },
          customer_message_draft: {
            type: 'string',
            description:
              'Short safe customer-facing message you plan to send. Must not claim the action succeeded.',
          },
        },
        required: [
          'blocker_type',
          'attempted_action',
          'customer_goal',
          'known_details',
          'blocking_reason',
          'last_tool_error',
          'retry_attempted',
          'customer_waiting',
          'customer_message_draft',
        ],
        additionalProperties: false,
      },
    },
  },
]

export async function executeHarrySmsTool(
  name: string,
  argsJson: string,
  ctx: HarrySmsToolContext,
): Promise<string> {
  const rl = checkToolRate(ctx.customerPhoneE164)
  if (!rl.ok) return JSON.stringify({ error: rl.error })

  const phoneVariants = phoneSearchVariants(ctx.customerPhoneE164)
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ error: 'Invalid tool arguments' })
  }

  const { supabase } = ctx

  try {
    switch (name) {
      case 'report_operational_problem': {
        const blockerType = String(args.blocker_type || '').trim()
        const attemptedAction = String(args.attempted_action || '').trim()
        const customerGoal = String(args.customer_goal || '').trim()
        const knownDetails = String(args.known_details || '').trim()
        const blockingReason = String(args.blocking_reason || '').trim()
        const lastToolError = String(args.last_tool_error || '').trim()
        const customerMessageDraft = String(
          args.customer_message_draft || '',
        ).trim()
        const retryAttempted = args.retry_attempted === true
        const customerWaiting = args.customer_waiting === true

        if (
          ![
            'tool_error_after_retry',
            'cannot_match_service',
            'cannot_match_appointment',
            'policy_conflict',
            'urgent_customer_issue',
            'missing_internal_capability',
          ].includes(blockerType)
        ) {
          return JSON.stringify({
            error:
              'Invalid blocker_type. Do not report normal missing customer information as an operational problem.',
          })
        }

        if (blockerType !== 'urgent_customer_issue' && !retryAttempted) {
          return JSON.stringify({
            error:
              'Do not escalate yet. First retry with the correct lookup tools and real IDs/tokens/services, or ask the customer for ordinary missing information.',
          })
        }

        const normalMissingInfo = [
          'email',
          'last name',
          'address',
          'city',
          'zip',
          'phone',
          'lead source',
          'minimum',
          '$150',
          'time slot',
          'slot unavailable',
        ]
        const reasonLower = `${blockingReason} ${lastToolError}`.toLowerCase()
        if (
          blockerType !== 'urgent_customer_issue' &&
          normalMissingInfo.some((term) => reasonLower.includes(term)) &&
          !reasonLower.includes('tool') &&
          !reasonLower.includes('uuid') &&
          !reasonLower.includes('system')
        ) {
          return JSON.stringify({
            error:
              'This looks like normal missing info, minimum-charge discussion, or unavailable scheduling. Ask the customer or offer real slots instead of escalating.',
          })
        }

        const now = Date.now()
        const lastReportAt = issueReportTimestamps.get(ctx.customerPhoneE164)
        if (lastReportAt && now - lastReportAt < ISSUE_REPORT_WINDOW_MS) {
          return JSON.stringify({
            success: true,
            already_reported: true,
            message:
              'A Harry issue report was already sent for this customer recently. Do not send another duplicate report; give the customer the safe follow-up message.',
          })
        }

        const report = [
          '🚧 Harry issue report',
          `Phone: ${ctx.customerPhoneE164}`,
          ctx.sessionId ? `Thread: ${ctx.sessionId}` : null,
          `Customer waiting: ${customerWaiting ? 'yes' : 'no'}`,
          `Blocker: ${blockerType}`,
          `Trying to: ${attemptedAction || 'unknown'}`,
          `Customer wants: ${customerGoal || 'unknown'}`,
          `Known details: ${knownDetails || 'not provided'}`,
          `Problem: ${blockingReason || 'not provided'}`,
          `Last tool/error: ${lastToolError || 'not provided'}`,
          `Harry should tell customer: ${customerMessageDraft || 'Charles will review and follow up shortly.'}`,
        ]
          .filter(Boolean)
          .join('\n')

        const telegramSent = await sendToCharles(report, {
          buttons: ctx.sessionId
            ? [
                [
                  { text: 'View Thread', data: `view_${ctx.sessionId}` },
                  { text: 'Take Over', data: `takeover_${ctx.sessionId}` },
                ],
              ]
            : undefined,
        })
        if (!telegramSent) {
          await sendAdminSMS(report, 'harry_operational_problem')
        }
        issueReportTimestamps.set(ctx.customerPhoneE164, now)

        return JSON.stringify({
          success: true,
          reported_to_charles: true,
          delivery: telegramSent ? 'telegram' : 'sms_fallback',
          message:
            'Operational problem reported to Charles. Now send the customer the provided safe message without claiming success.',
        })
      }

      case 'get_my_customer_profile': {
        const [profiles, conversations] = await Promise.all([
          lookupSmsCustomerProfiles(supabase, ctx.customerPhoneE164),
          lookupSmsConversationProfiles(supabase, ctx.customerPhoneE164),
        ])
        const hasIdentity =
          profiles.length > 0 ||
          conversations.some(
            (conversation) =>
              conversation.customer_name ||
              conversation.inferred_name ||
              conversation.inferred_email,
          )

        return JSON.stringify({
          phone_number_seen: ctx.customerPhoneE164,
          matched: hasIdentity,
          customer_profiles: profiles,
          conversation_profiles: conversations,
          message: hasIdentity
            ? 'Identity information found for this SMS number.'
            : 'No saved name/profile found for this SMS number, but the phone number is visible.',
        })
      }

      case 'list_my_upcoming_appointments': {
        const [customers, conversations] = await Promise.all([
          lookupSmsCustomerProfiles(supabase, ctx.customerPhoneE164),
          lookupSmsConversationProfiles(supabase, ctx.customerPhoneE164),
        ])

        if (!customers.length) {
          return JSON.stringify({
            upcoming: [],
            customer_profiles: [],
            conversation_profiles: conversations,
            phone_number_seen: ctx.customerPhoneE164,
            message:
              conversations.length > 0
                ? 'No Ops customer profile found for this phone yet, but conversation history exists.'
                : 'No customer profile found for this phone yet.',
          })
        }

        const customerIds = customers.map((c) => c.id)
        const today = todayMountain()

        const { data: rows, error: aErr } = await supabase
          .from('ops_appointments')
          .select(
            `
            id,
            appointment_date,
            start_time,
            end_time,
            status,
            ops_service_addresses ( street_1, city, state, zip_code )
          `,
          )
          .in('customer_id', customerIds)
          .in('status', [...UPCOMING_STATUSES])
          .gte('appointment_date', today)
          .order('appointment_date', { ascending: true })
          .limit(20)

        if (aErr) throw aErr

        const upcoming = (rows || []).map((r) => {
          const addr = r.ops_service_addresses as {
            street_1?: string
            city?: string
            state?: string
            zip_code?: string
          } | null
          const addressLine = addr
            ? `${addr.street_1 || ''}, ${addr.city || ''}, ${addr.state || ''} ${addr.zip_code || ''}`.trim()
            : ''
          const apptDayName = new Date(
            r.appointment_date + 'T12:00:00-06:00',
          ).toLocaleDateString('en-US', {
            weekday: 'long',
            timeZone: 'America/Denver',
          })
          return {
            appointment_id: r.id,
            date: r.appointment_date,
            day_of_week: apptDayName,
            start_time: String(r.start_time || '').slice(0, 5),
            status: r.status,
            address: addressLine,
          }
        })

        return JSON.stringify({
          phone_number_seen: ctx.customerPhoneE164,
          customer_profiles: customers,
          conversation_profiles: conversations,
          upcoming,
          message:
            upcoming.length > 0
              ? 'Customer profile and upcoming appointments found.'
              : 'Customer profile found, but no upcoming appointments found.',
        })
      }

      case 'search_service_catalog': {
        const q = String(args.query || '')
          .trim()
          .replace(/[%_\\]/g, ' ')
          .slice(0, 80)
        if (!q) return JSON.stringify({ services: [], error: 'Empty query' })

        const EXCLUDED_SERVICE_NAMES = [
          'Card fee',
          'Custom amount',
          'Discount',
          'Gratuity',
          'Mileage/ Travel',
          'Commercial carpet cleaning',
          'Commercial Carpet Cleaning',
          'Commercial Hard Floor Cleaning',
          'Low Moisture Encapsulation Cleaning LVM/Bonnet',
          'Commercial Deodorizer (Per Sqft)',
          'Auto scrubbing Floors (Lvt/Vinyl/Epoxy)',
          'Seal coat Vinyl/LVT flooring (per foot charge)',
        ]

        const searchCatalog = (query: string) =>
          supabase
            .from('service_catalog_items')
            .select(
              'id, name, slug, category, base_price, default_duration_minutes',
            )
            .eq('is_active', true)
            .or(`name.ilike.%${query}%,slug.ilike.%${query}%`)
            .limit(25)

        let { data: services, error } = await searchCatalog(q)
        if (!error && (!services || services.length === 0)) {
          const alternate = /humungous/i.test(q)
            ? q.replace(/humungous/gi, 'Humongous')
            : q.replace(/humongous/gi, 'Humungous')
          if (alternate !== q) {
            const retry = await searchCatalog(alternate)
            services = retry.data
            error = retry.error
          }
        }

        if (error) throw error
        const filtered = (services || []).filter(
          (s) => !EXCLUDED_SERVICE_NAMES.includes(s.name),
        )
        return JSON.stringify({
          services: filtered.map((s) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            base_price: s.base_price,
            default_duration_minutes: s.default_duration_minutes,
          })),
        })
      }

      case 'get_calendar_slots': {
        const date = String(args.date || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return JSON.stringify({ error: 'date must be YYYY-MM-DD' })
        }
        const today = todayMountain()
        if (date < today) {
          return JSON.stringify({
            date,
            slots: [],
            message: 'Cannot book in the past',
          })
        }

        const durationParam = Number(args.duration_minutes || 120)
        const requiredMinutes = applyAppointmentBuffer(
          durationParam > 0 ? durationParam : 120,
        )

        const bundle = await loadAvailabilityBundle(supabase, date)
        const slots = getAvailableSlots({
          date,
          requiredMinutes,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 12,
        })

        const dayName = new Date(date + 'T12:00:00-06:00').toLocaleDateString(
          'en-US',
          { weekday: 'long', timeZone: 'America/Denver' },
        )

        return JSON.stringify({
          date,
          day_of_week: dayName,
          slots: slots.map((s) => ({
            start_time: s.start_time.slice(0, 5),
            end_time: s.end_time.slice(0, 5),
            slot_token: createSlotToken({
              date,
              startTime: s.start_time,
              endTime: s.end_time,
              requiredMinutes,
              ownerKey: ctx.customerPhoneE164,
            }),
          })),
        })
      }

      case 'update_job_address': {
        const appointmentId = String(args.appointment_id || '').trim()
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        if (!appointmentId || !street1 || !city || !zipCode) {
          return JSON.stringify({ error: 'Missing address fields' })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const oldAddrId = owned.appointment.service_address_id

        const { count: sharedCount } = await supabase
          .from('ops_appointments')
          .select('id', { count: 'exact', head: true })
          .eq('service_address_id', oldAddrId)
          .neq('id', appointmentId)

        if (sharedCount && sharedCount > 0) {
          const { data: newAddr, error: addrErr } = await supabase
            .from('ops_service_addresses')
            .insert({
              customer_id: owned.appointment.customer_id,
              street_1: street1,
              city,
              state,
              zip_code: zipCode,
              label: 'Service Address',
            })
            .select('id')
            .single()
          if (addrErr) throw addrErr

          const { error: linkErr } = await supabase
            .from('ops_appointments')
            .update({
              service_address_id: newAddr.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', appointmentId)
          if (linkErr) throw linkErr
        } else {
          const { error: uErr } = await supabase
            .from('ops_service_addresses')
            .update({
              street_1: street1,
              city,
              state,
              zip_code: zipCode,
              updated_at: new Date().toISOString(),
            })
            .eq('id', oldAddrId)
          if (uErr) throw uErr
        }

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Address updated via Harry SMS → ${street1}, ${city}, ${state} ${zipCode}`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          address: `${street1}, ${city}, ${state} ${zipCode}`,
        })
      }

      case 'reschedule_job': {
        const appointmentId = String(args.appointment_id || '').trim()
        const newDate = String(args.new_appointment_date || '').trim()
        const newStartRaw = String(args.new_start_time || '').trim()
        const slotToken = String(args.slot_token || '').trim()
        if (!appointmentId || !newDate || !newStartRaw || !slotToken) {
          return JSON.stringify({ error: 'Missing reschedule fields' })
        }
        if (!isUuid(appointmentId)) {
          return JSON.stringify({
            error:
              'appointment_id must be the real UUID returned by list_my_upcoming_appointments. Call list_my_upcoming_appointments first; do not invent an ID.',
          })
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
          return JSON.stringify({
            error: 'new_appointment_date must be YYYY-MM-DD',
          })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const { data: lineRows, error: liErr } = await supabase
          .from('ops_appointment_line_items')
          .select('duration_minutes, quantity, unit_price, name_snapshot')
          .eq('appointment_id', appointmentId)

        if (liErr) throw liErr

        const totalMinutesFromLines = (lineRows || []).reduce(
          (sum, item) =>
            sum +
            calculateLineItemDurationMinutes({
              durationMinutes: Number(item.duration_minutes),
              quantity: Number(item.quantity),
              unitPrice: Number(item.unit_price),
              nameSnapshot: String(item.name_snapshot || ''),
            }),
          0,
        )
        const totalMinutesWithBuffer = applyAppointmentBuffer(
          totalMinutesFromLines || 120,
        )

        const bundle = await loadAvailabilityBundle(
          supabase,
          newDate,
          appointmentId,
        )
        const slots = getAvailableSlots({
          date: newDate,
          requiredMinutes: totalMinutesWithBuffer,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 48,
        })

        const wantStart = normClock5(newStartRaw)
        const match = slots.find((s) => normClock5(s.start_time) === wantStart)
        if (!match) {
          return JSON.stringify({
            error: `That start time is not available on ${newDate}. Call get_calendar_slots for that date first.`,
            suggested_slots: slots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }
        const slotTokenCheck = verifySlotToken(slotToken, {
          date: newDate,
          startTime: match.start_time,
          endTime: match.end_time,
          ownerKey: ctx.customerPhoneE164,
        })
        if (!slotTokenCheck.ok) {
          return JSON.stringify({
            error: `${slotTokenCheck.error} You must call get_calendar_slots and use the returned slot_token before rescheduling.`,
          })
        }

        const nextStartDb = toDbTime(newStartRaw)
        const nextEndDb = addMinutesToTime(
          nextStartDb.slice(0, 5),
          totalMinutesWithBuffer,
        )

        const prevDate = owned.appointment.appointment_date
        const prevStart = owned.appointment.start_time

        const { error: upErr } = await supabase
          .from('ops_appointments')
          .update({
            appointment_date: newDate,
            start_time: nextStartDb,
            end_time: nextEndDb,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)

        if (upErr) throw upErr

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Rescheduled via Harry SMS (${prevDate} ${String(prevStart).slice(0, 5)} → ${newDate} ${wantStart})`,
        })

        const prevDayName = new Date(
          prevDate + 'T12:00:00-06:00',
        ).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'America/Denver',
        })
        const newDayLabel = new Date(
          newDate + 'T12:00:00-06:00',
        ).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: 'America/Denver',
        })
        const custName = owned.customerName || 'Customer'
        const rescheduleMsg =
          `📅 Reschedule via Harry SMS\n` +
          `👤 ${custName}\n` +
          `📞 ${ctx.customerPhoneE164}\n` +
          `❌ Was: ${prevDayName} at ${String(prevStart).slice(0, 5)}\n` +
          `✅ Now: ${newDayLabel} at ${wantStart}`

        await Promise.allSettled([
          sendToCharles(rescheduleMsg),
          sendAdminSMS(rescheduleMsg, 'reschedule_notification'),
          sendCustomerSMS(
            ctx.customerPhoneE164,
            `Hi ${custName}! This confirms your Sasquatch Carpet Cleaning appointment has been rescheduled to ${newDayLabel} at ${wantStart}. See you then!`,
            undefined,
            'reschedule_confirmation',
          ),
        ])

        const reschDayName = new Date(
          newDate + 'T12:00:00-06:00',
        ).toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'America/Denver',
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          new_appointment_date: newDate,
          new_day_of_week: reschDayName,
          new_start_time: wantStart,
        })
      }

      case 'update_job_line_items': {
        const appointmentId = String(args.appointment_id || '').trim()
        const newLineItems = Array.isArray(args.line_items)
          ? args.line_items
          : []

        if (!appointmentId) {
          return JSON.stringify({ error: 'appointment_id is required' })
        }
        if (!newLineItems.length) {
          return JSON.stringify({ error: 'line_items required' })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        const parsedItems = newLineItems.map((row: unknown) => {
          const r = row as { service_id?: string; quantity?: number }
          return {
            service_id: String(r.service_id || '').trim(),
            quantity: Math.max(1, Number(r.quantity) || 1),
          }
        })

        const catalogIds = parsedItems.map((l) => l.service_id)
        const { data: catalogRows, error: catErr } = await supabase
          .from('service_catalog_items')
          .select(
            'id, name, slug, base_price, default_duration_minutes, pricing_unit',
          )
          .in('id', catalogIds)
          .eq('is_active', true)

        if (catErr || !catalogRows?.length) {
          return JSON.stringify({
            error: 'Could not find the requested services in the catalog.',
          })
        }

        let updateLineItemsTotalMinutes = 0
        const builtLines = parsedItems
          .map((req) => {
            const cat = catalogRows.find((c) => c.id === req.service_id)
            if (!cat) return null
            const unitPrice = Number(cat.base_price || 0)
            const quantity = req.quantity
            const durationMinutes = cat.default_duration_minutes || 60
            updateLineItemsTotalMinutes += calculateLineItemDurationMinutes({
              durationMinutes,
              quantity,
              pricingUnit: cat.pricing_unit ?? null,
              unitPrice,
              catalogSlug: cat.slug ?? null,
              nameSnapshot: cat.name,
            })
            return {
              appointment_id: appointmentId,
              name_snapshot: cat.name,
              quantity,
              unit_price: unitPrice,
              duration_minutes: durationMinutes,
              line_total: unitPrice * quantity,
            }
          })
          .filter(Boolean) as Array<{
          appointment_id: string
          name_snapshot: string
          quantity: number
          unit_price: number
          duration_minutes: number
          line_total: number
        }>

        if (!builtLines.length) {
          return JSON.stringify({
            error:
              'None of the requested services matched active catalog items.',
          })
        }

        const MIN_JOB_TOTAL = 150
        const preCheckTotal = builtLines.reduce((s, l) => s + l.line_total, 0)
        if (preCheckTotal < MIN_JOB_TOTAL) {
          return JSON.stringify({
            error: `Job total of $${preCheckTotal.toFixed(2)} is below the $${MIN_JOB_TOTAL} minimum. Please add more services or increase quantities.`,
          })
        }

        // Delete old line items and insert new ones
        await supabase
          .from('ops_appointment_line_items')
          .delete()
          .eq('appointment_id', appointmentId)

        await supabase.from('ops_appointment_line_items').insert(builtLines)

        // Recalculate total and end_time
        const newTotal = builtLines.reduce((s, l) => s + l.line_total, 0)
        const totalMinutes = updateLineItemsTotalMinutes
        const buffered = applyAppointmentBuffer(totalMinutes || 120)
        const newEndTime = addMinutesToTime(
          owned.appointment.start_time.slice(0, 5),
          buffered,
        )

        await supabase
          .from('ops_appointments')
          .update({
            quoted_total: newTotal,
            end_time: newEndTime,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)

        // Also update the invoice if one exists
        const { data: invoice } = await supabase
          .from('ops_invoices')
          .select('id, quickbooks_invoice_id')
          .eq('appointment_id', appointmentId)
          .maybeSingle()

        if (invoice) {
          await supabase
            .from('ops_invoice_line_items')
            .delete()
            .eq('invoice_id', invoice.id)

          await supabase.from('ops_invoice_line_items').insert(
            builtLines.map((l) => ({
              invoice_id: invoice.id,
              description: l.name_snapshot,
              quantity: l.quantity,
              unit_price: l.unit_price,
              line_total: l.line_total,
            })),
          )

          await supabase
            .from('ops_invoices')
            .update({
              subtotal: newTotal,
              total: newTotal,
              updated_at: new Date().toISOString(),
            })
            .eq('id', invoice.id)

          if (invoice.quickbooks_invoice_id) {
            void resyncInvoiceToQuickBooks(invoice.id).catch((qbErr) =>
              console.error(
                '[sms-harry-tools] QB invoice resync after line update:',
                qbErr,
              ),
            )
          }
        }

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Line items updated via Harry SMS. New total: $${newTotal.toFixed(2)}`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          new_total: newTotal,
          services: builtLines.map((l) => ({
            name: l.name_snapshot,
            qty: l.quantity,
            price: l.unit_price * l.quantity,
          })),
        })
      }

      case 'add_job_note': {
        const appointmentId = String(args.appointment_id || '').trim()
        const note = String(args.note || '').trim()

        if (!appointmentId || !note) {
          return JSON.stringify({
            error: 'appointment_id and note are required',
          })
        }

        const owned = await customerOwnsAppointment(
          supabase,
          appointmentId,
          ctx.customerPhoneE164,
        )
        if (!owned.ok) return JSON.stringify({ error: owned.error })

        // Get existing notes and append new note with timestamp
        const existingNotes = owned.appointment.internal_notes || ''
        const timestamp = new Date().toLocaleString('en-US', {
          timeZone: 'America/Denver',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
        const newNote = `[${timestamp} via Harry SMS] ${note}`
        const updatedNotes = existingNotes
          ? `${existingNotes}\n${newNote}`
          : newNote

        const { error: updateErr } = await supabase
          .from('ops_appointments')
          .update({
            internal_notes: updatedNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)

        if (updateErr) throw updateErr

        await supabase.from('ops_appointment_status_events').insert({
          appointment_id: appointmentId,
          from_status: owned.appointment.status,
          to_status: owned.appointment.status,
          notes: `Note added via Harry SMS: ${note}`,
        })

        return JSON.stringify({
          success: true,
          appointment_id: appointmentId,
          note_added: note,
        })
      }

      case 'book_new_job': {
        const firstName = String(args.first_name || '').trim()
        const lastName = String(args.last_name || '').trim()
        const email = String(args.email || '').trim()
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        const appointmentDate = String(args.appointment_date || '').trim()
        const startTime = String(args.start_time || '').trim()
        const slotToken = String(args.slot_token || '').trim()
        const lineItems = Array.isArray(args.line_items) ? args.line_items : []
        const acceptedMinimumCharge = args.accepted_minimum_charge === true

        // For Google LSA relay conversations, Harry must collect the real customer phone
        const rawCustomerPhone = String(args.customer_phone || '').trim()
        const normalizedCustomerPhone = rawCustomerPhone
          ? '+1' + rawCustomerPhone.replace(/\D/g, '').slice(-10)
          : ''

        // Use customer-provided phone if given, otherwise use SMS number
        const bookingPhone = normalizedCustomerPhone || ctx.customerPhoneE164

        // LSA conversations MUST have explicit customer_phone - relay can't receive texts
        if (ctx.isLsaRelay && !normalizedCustomerPhone) {
          console.error(
            '[book_new_job] LSA booking attempted without customer_phone',
            {
              relay: ctx.customerPhoneE164,
              providedPhone: rawCustomerPhone,
            },
          )
          return JSON.stringify({
            error:
              'customer_phone is required for Google LSA leads. Ask the customer: "What\'s the best phone number to reach you for confirmations?"',
          })
        }

        // Log phone usage for LSA bookings to help debug relay number issues
        if (ctx.isLsaRelay) {
          console.log('[book_new_job] LSA booking with phone numbers', {
            relay: ctx.customerPhoneE164,
            customerProvided: normalizedCustomerPhone,
            willUse: bookingPhone,
          })
        }

        if (!firstName || !lastName || !email) {
          return JSON.stringify({
            error: 'first_name, last_name, and email are required',
          })
        }
        if (!street1 || !city || !zipCode) {
          return JSON.stringify({
            error: 'street_1, city, and zip_code are required',
          })
        }
        if (!appointmentDate || !startTime || !slotToken) {
          return JSON.stringify({
            error: 'appointment_date, start_time, and slot_token are required',
          })
        }
        if (!lineItems.length) {
          return JSON.stringify({ error: 'line_items required' })
        }

        // Guard: prevent duplicate booking for same customer on same date
        const { data: existingCusts } = await supabase
          .from('ops_customers')
          .select('id')
          .in('phone', phoneVariants)

        if (existingCusts && existingCusts.length > 0) {
          const custIds = existingCusts.map((c) => c.id)
          const { data: existingAppts } = await supabase
            .from('ops_appointments')
            .select('id, start_time, status')
            .in('customer_id', custIds)
            .eq('appointment_date', appointmentDate)
            .in('status', [
              'booked',
              'confirmed',
              'on_my_way',
              'in_progress',
              'pending_approval',
            ])
            .limit(1)

          if (existingAppts && existingAppts.length > 0) {
            const dup = existingAppts[0]
            return JSON.stringify({
              error: `This customer already has a booking on ${appointmentDate} (appointment_id: ${dup.id}). Use update_job_line_items to fix the services or reschedule_job to change the time. Do NOT create a duplicate.`,
            })
          }
        }

        const parsedLineItems = lineItems.map((row: unknown) => {
          const r = row as { service_id?: string; quantity?: number }
          return {
            service_id: String(r.service_id || '').trim(),
            quantity: Math.max(1, Number(r.quantity) || 1),
          }
        })
        const invalidServiceIds = parsedLineItems
          .map((l) => l.service_id)
          .filter((id) => !isUuid(id))
        if (invalidServiceIds.length > 0) {
          return JSON.stringify({
            error:
              'Every line_items.service_id must be a real UUID returned by search_service_catalog. Call search_service_catalog for each service and retry with those exact IDs.',
            invalid_service_ids: invalidServiceIds,
          })
        }

        const catalogIds = parsedLineItems.map((l) => l.service_id)
        const { data: catalogRows } = await supabase
          .from('service_catalog_items')
          .select(
            'id, slug, default_duration_minutes, base_price, pricing_unit',
          )
          .in('id', catalogIds)
          .eq('is_active', true)

        const foundIds = new Set((catalogRows || []).map((row) => row.id))
        const missingCatalogIds = catalogIds.filter((id) => !foundIds.has(id))
        if (missingCatalogIds.length > 0) {
          return JSON.stringify({
            error:
              'No valid services found for one or more service IDs. Call search_service_catalog and retry with active service IDs returned by the tool.',
            missing_service_ids: missingCatalogIds,
          })
        }

        const BOOK_MIN_TOTAL = 150
        const isLsa = ctx.isLsaRelay === true
        const preTotal = (catalogRows || []).reduce((sum, row) => {
          const qty =
            parsedLineItems.find((p) => p.service_id === row.id)?.quantity ?? 1
          return sum + Number(row.base_price || 0) * qty
        }, 0)
        const preTotalWithAutomaticCharges =
          preTotal + (isLsa ? GOOGLE_LSA_LEAD_RECOVERY_AMOUNT : 0)
        if (
          preTotalWithAutomaticCharges < BOOK_MIN_TOTAL &&
          !acceptedMinimumCharge
        ) {
          return JSON.stringify({
            error: `Job total of $${preTotalWithAutomaticCharges.toFixed(2)} is below the $${BOOK_MIN_TOTAL} minimum. If the customer explicitly agrees to pay the $${BOOK_MIN_TOTAL} minimum anyway, call book_new_job again with accepted_minimum_charge: true.`,
          })
        }

        const totalMinutes = (catalogRows || []).reduce((sum, row) => {
          const qty =
            parsedLineItems.find((p) => p.service_id === row.id)?.quantity ?? 1
          const unitPrice = Number(row.base_price || 0)
          return (
            sum +
            calculateLineItemDurationMinutes({
              durationMinutes: Number(row.default_duration_minutes || 60),
              quantity: qty,
              pricingUnit: row.pricing_unit ?? null,
              unitPrice,
              catalogSlug: row.slug ?? null,
              nameSnapshot: null,
            })
          )
        }, 0)

        const requiredMinutes = applyAppointmentBuffer(totalMinutes || 120)
        const bundle = await loadAvailabilityBundle(supabase, appointmentDate)
        const slots = getAvailableSlots({
          date: appointmentDate,
          requiredMinutes,
          templates: bundle.templates,
          overrides: bundle.overrides,
          appointments: bundle.appointments,
          maxResults: 48,
        })

        const wantStart = normClock5(startTime)
        const match = slots.find((s) => normClock5(s.start_time) === wantStart)
        if (!match) {
          return JSON.stringify({
            error: `That start time is not available on ${appointmentDate}. Use get_calendar_slots with duration matching the services first.`,
            suggested_slots: slots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }
        const slotTokenCheck = verifySlotToken(slotToken, {
          date: appointmentDate,
          startTime: match.start_time,
          endTime: match.end_time,
          requiredMinutes,
          ownerKey: ctx.customerPhoneE164,
        })
        if (!slotTokenCheck.ok) {
          return JSON.stringify({
            error: `${slotTokenCheck.error} You must call get_calendar_slots and use the returned slot_token before booking.`,
          })
        }

        const bookingMode =
          process.env.HARRY_SMS_BOOKING_MODE === 'request'
            ? 'request'
            : 'direct'

        const providedLeadSource = String(args.lead_source || '').trim()
        const resolvedLeadSource =
          providedLeadSource || (isLsa ? 'Google LSA' : 'Harry SMS Assistant')

        if (!providedLeadSource) {
          return JSON.stringify({
            error:
              'lead_source is required. Ask the customer: "How did you hear about us?" before booking.',
          })
        }

        // Double-check: for LSA, bookingPhone MUST be the customer-provided number
        if (ctx.isLsaRelay && bookingPhone === ctx.customerPhoneE164) {
          return JSON.stringify({
            error:
              'SYSTEM ERROR: LSA booking attempted with relay number. The customer\'s real callback number was not captured. Ask: "What\'s the best phone number to reach you for confirmations?"',
          })
        }

        const result = await createAiStyleBooking({
          supabase,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email,
            phone: bookingPhone,
          },
          address: { street_1: street1, city, state, zip_code: zipCode },
          appointment_date: appointmentDate,
          start_time: startTime,
          line_items: parsedLineItems,
          booking_mode: bookingMode,
          booking_channel: isLsa ? 'lsa_sms' : 'sms_harry',
          source_label: isLsa ? 'Google LSA' : 'Harry SMS',
          lead_source: resolvedLeadSource,
          actor_label: isLsa ? 'Harry LSA' : 'Harry SMS',
          admin_heading: isLsa ? 'Google LSA booking' : 'Harry SMS booking',
          accepted_minimum_charge: acceptedMinimumCharge,
        })

        if (!result.ok) {
          return JSON.stringify({ error: result.error })
        }

        const bookDayName = new Date(
          result.appointment_date + 'T12:00:00-06:00',
        ).toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'America/Denver',
        })

        return JSON.stringify({
          success: true,
          confirmation_number: result.confirmation_number,
          status: result.appointment_status,
          appointment_date: result.appointment_date,
          day_of_week: bookDayName,
          start_time: result.start_time.slice(0, 5),
          total: result.total,
          message: result.message,
        })
      }

      case 'book_commercial_estimate': {
        const firstName = String(args.first_name || '').trim()
        const lastName = String(args.last_name || '').trim()
        const businessName = String(args.business_name || '').trim() || null
        const email = String(args.email || '').trim()
        const street1 = String(args.street_1 || '').trim()
        const city = String(args.city || '').trim()
        const state = String(args.state || 'CO').trim() || 'CO'
        const zipCode = String(args.zip_code || '').trim()
        const appointmentDate = String(args.appointment_date || '').trim()
        const startTime = String(args.start_time || '').trim()
        const slotToken = String(args.slot_token || '').trim()
        const jobDescription = String(args.job_description || '').trim() || null

        // For LSA relay conversations Harry must collect the real customer
        // callback; otherwise use the SMS number.
        const rawCustomerPhone = String(args.customer_phone || '').trim()
        const normalizedCustomerPhone = rawCustomerPhone
          ? '+1' + rawCustomerPhone.replace(/\D/g, '').slice(-10)
          : ''
        const bookingPhone = ctx.isLsaRelay
          ? normalizedCustomerPhone
          : normalizedCustomerPhone || ctx.customerPhoneE164

        if (!bookingPhone) {
          return JSON.stringify({
            error:
              'customer_phone is required. Ask the customer for their 10-digit callback number.',
          })
        }
        if (!firstName || !lastName || !email) {
          return JSON.stringify({
            error: 'first_name, last_name, and email are required',
          })
        }
        if (!street1 || !city || !zipCode) {
          return JSON.stringify({
            error: 'street_1, city, and zip_code are required',
          })
        }
        if (!appointmentDate || !startTime || !slotToken) {
          return JSON.stringify({
            error: 'appointment_date, start_time, and slot_token are required',
          })
        }

        const isLsa = ctx.isLsaRelay === true
        const estimateBundle = await loadAvailabilityBundle(
          supabase,
          appointmentDate,
        )
        const estimateRequiredMinutes = applyAppointmentBuffer(60)
        const estimateSlots = getAvailableSlots({
          date: appointmentDate,
          requiredMinutes: estimateRequiredMinutes,
          templates: estimateBundle.templates,
          overrides: estimateBundle.overrides,
          appointments: estimateBundle.appointments,
          maxResults: 48,
        })
        const estimateMatch = estimateSlots.find(
          (s) => normClock5(s.start_time) === normClock5(startTime),
        )
        if (!estimateMatch) {
          return JSON.stringify({
            error: `That start time is not available on ${appointmentDate}. Call get_calendar_slots with duration_minutes=60 first.`,
            suggested_slots: estimateSlots
              .slice(0, 8)
              .map((s) => s.start_time.slice(0, 5)),
          })
        }
        const estimateSlotTokenCheck = verifySlotToken(slotToken, {
          date: appointmentDate,
          startTime: estimateMatch.start_time,
          endTime: estimateMatch.end_time,
          requiredMinutes: estimateRequiredMinutes,
          ownerKey: ctx.customerPhoneE164,
        })
        if (!estimateSlotTokenCheck.ok) {
          return JSON.stringify({
            error: `${estimateSlotTokenCheck.error} You must call get_calendar_slots and use the returned slot_token before booking a commercial walkthrough.`,
          })
        }

        const result = await createAiStyleEstimate({
          supabase,
          customer: {
            first_name: firstName,
            last_name: lastName,
            business_name: businessName,
            email,
            phone: bookingPhone,
          },
          address: { street_1: street1, city, state, zip_code: zipCode },
          appointment_date: appointmentDate,
          start_time: startTime,
          visit_duration_minutes: 60,
          job_description: jobDescription,
          booking_channel: isLsa ? 'lsa_sms' : 'sms_harry',
          source_label: isLsa ? 'Google LSA' : 'Harry SMS',
          actor_label: isLsa ? 'Harry LSA' : 'Harry SMS',
          admin_heading: isLsa
            ? 'Google LSA walkthrough'
            : 'Harry SMS walkthrough',
        })

        if (!result.ok) {
          return JSON.stringify({
            error: result.error,
            ...(result.suggested_slots
              ? { suggested_slots: result.suggested_slots }
              : {}),
          })
        }

        const estDayName = new Date(
          result.appointment_date + 'T12:00:00-06:00',
        ).toLocaleDateString('en-US', {
          weekday: 'long',
          timeZone: 'America/Denver',
        })

        return JSON.stringify({
          success: true,
          confirmation_number: result.confirmation_number,
          appointment_date: result.appointment_date,
          day_of_week: estDayName,
          start_time: result.start_time,
          visit_duration_minutes: result.visit_duration_minutes,
          message: result.message,
        })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (e) {
    console.error('[Harry SMS tool]', name, e)
    return JSON.stringify({
      error: 'Action failed. The office can help at (719) 249-8791.',
    })
  }
}

export function isHarrySmsOpsToolsEnabled(): boolean {
  return process.env.HARRY_SMS_OPS_TOOLS !== 'false'
}
