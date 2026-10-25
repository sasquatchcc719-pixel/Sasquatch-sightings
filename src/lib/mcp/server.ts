import { readScheduleGaps, readGapCandidates } from '@/lib/ops/gap-read'
import {
  previewGapOutreach,
  executeGapOutreach,
  readGapOutreach,
  stopGapOutreach,
} from '@/lib/ops/gap-outreach'
import { createAdminClient } from '@/supabase/server'
import {
  scheduleGapsInput,
  gapCandidatesInput,
  gapBatchInput,
  gapPreviewInput,
  gapExecuteInput,
  gapOutput,
  gapRecordsOutput,
} from './gap-schemas'
import {
  McpServer,
  type AuthInfo,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  MCP_AUTH_SCOPES,
  MCP_BUSINESS_SCOPE,
  MCP_RESOURCE_METADATA,
} from './constants'
import {
  assertMcpToolCatalog,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from './release'
import {
  appointmentDetailOutputSchema,
  appointmentListOutputSchema,
  unscheduledAppointmentListOutputSchema,
  availabilityOutputSchema,
  businessConfigurationOutputSchema,
  businessSearchOutputSchema,
  callsOutputSchema,
  capabilityCatalogOutputSchema,
  conversationDetailOutputSchema,
  conversationListOutputSchema,
  customerListOutputSchema,
  estimateDetailOutputSchema,
  estimateListOutputSchema,
  invoiceDetailOutputSchema,
  operationalSummaryOutputSchema,
  actionExecutionOutputSchema,
  actionPreviewOutputSchema,
  savedConversationDraftOutputSchema,
} from './schemas'
import {
  getBusinessConfiguration,
  getCapabilityCatalog,
  getOperationalSummary,
  searchBusinessRecords,
} from './operations'
import {
  executePreparedAction,
  getConversation,
  getInvoice,
  listUnscheduledAppointments,
  listConversations,
  previewAppointmentCreate,
  previewAppointmentUpdate,
  previewConversationSend,
  previewCustomerUpdate,
  previewEstimateDecision,
  previewEstimateConversion,
  previewEstimateSend,
  previewEstimateSave,
  saveConversationDraft,
  type McpActor,
} from './business-operations'
import { getApiV1 } from './upstream'

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, 'Use a valid calendar date')

const paginationFields = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().nonnegative().default(0),
}

const listAppointmentsInput = z
  .object({
    date: dateSchema.optional().describe('One America/Denver calendar date.'),
    start: dateSchema
      .optional()
      .describe('Inclusive America/Denver range start.'),
    end: dateSchema.optional().describe('Inclusive America/Denver range end.'),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
    tech: z.string().trim().min(1).max(100).optional(),
    ...paginationFields,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.date && (value.start || value.end)) {
      context.addIssue({
        code: 'custom',
        message: 'date cannot be combined with start or end',
      })
    }
    if (!value.date && (!value.start || !value.end)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide date, or provide both start and end',
      })
    }
    if (value.start && value.end && value.start > value.end) {
      context.addIssue({
        code: 'custom',
        message: 'start must be on or before end',
      })
    }
  })

const listUnscheduledAppointmentsInput = z
  .object({ ...paginationFields })
  .strict()

const getByIdInput = z.object({ id: z.string().uuid() }).strict()
const listEstimatesInput = z
  .object({
    status: z.enum(['accepted', 'pending', 'declined']).optional(),
    ...paginationFields,
  })
  .strict()
const searchCustomersInput = z
  .object({
    phone: z.string().trim().min(1).max(32).optional(),
    email: z.string().trim().email().max(254).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    ...paginationFields,
  })
  .strict()
const availabilityInput = z
  .object({ date: dateSchema, ...paginationFields })
  .strict()
const callsInput = z
  .object({
    since: z
      .string()
      .trim()
      .max(64)
      .refine(
        (value) =>
          /^\d{4}-\d{2}-\d{2}$/.test(value) ||
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
            value,
          ),
        'Use YYYY-MM-DD or an ISO 8601 timestamp with a timezone',
      )
      .optional(),
    ...paginationFields,
  })
  .strict()
const noInput = z.object({}).strict()
const businessSearchInput = z
  .object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe(
        'Customer name, business name, phone, email, UUID, or invoice number.',
      ),
    entity: z
      .enum([
        'all',
        'customer',
        'appointment',
        'estimate',
        'invoice',
        'conversation',
      ])
      .default('all'),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
const operationalSummaryInput = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe(
        'Look-back window for calls/notification failures and look-ahead window for jobs.',
      ),
    item_limit: z
      .number()
      .int()
      .min(0)
      .max(25)
      .default(10)
      .describe(
        'Maximum example rows returned for each queue. Counts may be larger.',
      ),
  })
  .strict()

const conversationListInput = z
  .object({
    status: z.enum(['active', 'completed', 'escalated']).optional(),
    source: z.string().trim().min(1).max(80).optional(),
    customer_id: z.string().uuid().optional(),
    phone: z.string().trim().min(7).max(32).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    ...paginationFields,
  })
  .strict()
const conversationDetailInput = z
  .object({
    id: z.string().uuid(),
    message_limit: z.number().int().min(1).max(100).default(50),
    message_offset: z.number().int().nonnegative().default(0),
    include_media: z.boolean().default(true),
  })
  .strict()
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .describe('Caller-generated stable key for this exact requested action.')
const saveConversationDraftInput = z
  .object({
    conversation_id: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict()
const customerChanges = z
  .object({
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    full_name: z.string().trim().max(200).optional(),
    business_name: z.string().trim().max(200).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: z.string().trim().min(7).max(32).optional(),
    notes: z.string().max(4000).nullable().optional(),
    email_opt_out: z.boolean().optional(),
  })
  .strict()
const addressChanges = z
  .object({
    id: z.string().uuid(),
    label: z.string().trim().max(100).nullable().optional(),
    street_1: z.string().trim().max(200).optional(),
    street_2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().length(2).optional(),
    zip_code: z.string().trim().max(10).optional(),
    gate_code: z.string().trim().max(100).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
const previewCustomerUpdateInput = z
  .object({
    customer_id: z.string().uuid(),
    customer: customerChanges.optional(),
    address: addressChanges.optional(),
    idempotency_key: idempotencyKey,
  })
  .strict()
  .refine((value) => value.customer || value.address, {
    message: 'Provide customer and/or address changes',
  })
const previewConversationSendInput = z
  .object({
    conversation_id: z.string().uuid(),
    body: z.string().trim().min(1).max(1600),
    media_ids: z.array(z.string().uuid()).max(5).default([]),
    idempotency_key: idempotencyKey,
  })
  .strict()
const previewAppointmentUpdateInput = z
  .object({
    appointment_id: z.string().uuid(),
    appointment_date: dateSchema.optional(),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    assigned_staff_user_id: z.string().uuid().nullable().optional(),
    internal_notes: z.string().max(8000).nullable().optional(),
    cancel: z.boolean().default(false),
    park_on_cancel: z.boolean().default(true),
    notify_customer: z.boolean().default(false),
    idempotency_key: idempotencyKey,
  })
  .strict()
  .refine(
    (value) =>
      value.cancel ||
      value.appointment_date !== undefined ||
      value.start_time !== undefined ||
      value.assigned_staff_user_id !== undefined ||
      value.internal_notes !== undefined,
    { message: 'Provide a schedule, assignment, note, or cancellation change' },
  )
const previewAppointmentCreateInput = z
  .object({
    customer: z
      .object({
        first_name: z.string().trim().min(1).max(100),
        last_name: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(254),
        phone: z.string().trim().min(7).max(32),
      })
      .strict(),
    address: z
      .object({
        street_1: z.string().trim().min(1).max(200),
        street_2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().length(2).default('CO'),
        zip_code: z
          .string()
          .trim()
          .regex(/^\d{5}(?:-\d{4})?$/),
      })
      .strict(),
    appointment_date: dateSchema,
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    line_items: z
      .array(
        z
          .object({
            service_id: z.string().uuid(),
            quantity: z.number().positive().max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    assigned_staff_user_id: z.string().uuid().optional(),
    lead_source: z.string().trim().min(1).max(120),
    lead_source_detail: z.string().trim().max(500).nullable().optional(),
    accepted_minimum_charge: z.boolean().default(false),
    gap_offer_id: z.string().uuid().optional(),
    approve_alternate_offer: z.boolean().default(false),
    notify_customer: z.boolean().default(false),
    notify_internal: z.boolean().default(true),
    sync_quickbooks: z.boolean().default(true),
    idempotency_key: idempotencyKey,
  })
  .strict()
const estimateLineInput = z
  .object({
    service_id: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(10000),
    unit_price: z.number().nonnegative().max(1_000_000),
  })
  .strict()
const previewEstimateSaveInput = z
  .object({
    estimate_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    service_address_id: z.string().uuid().optional(),
    appointment_date: dateSchema.optional(),
    start_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
      .optional(),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
      .optional(),
    assigned_staff_user_id: z.string().uuid().nullable().optional(),
    internal_notes: z.string().max(8000).nullable().optional(),
    line_items: z.array(estimateLineInput).min(1).max(100).optional(),
    idempotency_key: idempotencyKey,
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.estimate_id) {
      for (const key of [
        'customer_id',
        'service_address_id',
        'appointment_date',
        'start_time',
        'end_time',
        'assigned_staff_user_id',
        'line_items',
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required for a new estimate`,
          })
        }
      }
    }
  })
const previewEstimateDecisionInput = z
  .object({
    estimate_id: z.string().uuid(),
    decision: z.enum(['accepted', 'declined']),
    reason: z.string().trim().min(1).max(1000).nullable().optional(),
    idempotency_key: idempotencyKey,
  })
  .strict()
const previewEstimateSendInput = z
  .object({
    estimate_id: z.string().uuid(),
    reopen: z.boolean().default(false),
    reason: z.string().trim().min(1).max(1000).nullable().optional(),
    idempotency_key: idempotencyKey,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reopen && !value.reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason is required when reopen=true',
      })
    }
  })
const previewEstimateConversionInput = z
  .object({
    estimate_id: z.string().uuid(),
    appointment_date: dateSchema,
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    assigned_staff_user_id: z.string().uuid(),
    discount_amount: z.number().nonnegative().max(1_000_000).default(0),
    gap_offer_id: z.string().uuid().optional(),
    approve_alternate_offer: z.boolean().default(false),
    notify_customer: z.boolean().default(false),
    sync_quickbooks: z.boolean().default(true),
    idempotency_key: idempotencyKey,
  })
  .strict()
const executeConfirmedActionInput = z
  .object({
    confirmation_id: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict()

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const stateChangeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const customerContactAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

const financialActionAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

const cancellationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const

const securitySchemes = [
  { type: 'oauth2' as const, scopes: [...MCP_AUTH_SCOPES] },
]

export const MCP_SERVER_INSTRUCTIONS =
  "Operate as Charles's trusted secretary. A direct instruction from the authenticated owner to perform an exact exposed action counts as authorization; preview and revalidate it, then execute without asking the same question again when the preview matches. A single native ChatGPT approval is enough. Standing authority covers routine factual replies and exact customer-accepted bookings or schedule changes, but never invent terms. Ask once before a new or materially changed customer, schedule, price, estimate, invoice, payment, refund, or liability commitment. Never perform unbounded bulk contact or campaigns; bounded gap outreach requires exact owner approval, separate activation and outreach:write. Never perform deletion, credential or permission administration, arbitrary code/HTTP/SQL/shell, charges, or refunds. Availability is not a booking."

type HandlerExtra = ServerContext

function authInfo(extra: HandlerExtra): AuthInfo {
  const info = extra.http?.authInfo
  const subject = info?.extra?.subject
  if (
    !info ||
    !info.scopes.includes(MCP_BUSINESS_SCOPE) ||
    typeof subject !== 'string' ||
    !subject ||
    (typeof info.expiresAt === 'number' && info.expiresAt <= Date.now() / 1000)
  ) {
    throw new Error('OAuth authorization is required')
  }
  return info
}

function params(values: Record<string, unknown>): URLSearchParams {
  const result = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) result.set(key, String(value))
  }
  return result
}

function toolResult(body: Record<string, unknown>) {
  return {
    structuredContent: body,
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
  }
}

type ToolDefinition = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  annotations?: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
  handler: (
    input: Record<string, unknown>,
    extra: HandlerExtra,
  ) => Promise<ReturnType<typeof toolResult>>
}

function actorInfo(extra: HandlerExtra): McpActor {
  const info = authInfo(extra)
  return {
    subject: String(info.extra?.subject),
    label:
      typeof info.extra?.displayName === 'string'
        ? info.extra.displayName
        : typeof info.extra?.email === 'string'
          ? info.extra.email
          : String(info.extra?.subject),
    scopes: [...info.scopes],
  }
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_appointments',
    title: 'List appointments',
    description:
      'List real appointments for one America/Denver date or an inclusive start/end date range. Optional status maps active booked states to scheduled, and tech is a case-insensitive technician-name match. Results are read-only and paginated; this tool does not book or alter appointments.',
    inputSchema: listAppointmentsInput,
    outputSchema: appointmentListOutputSchema,
    async handler(input, extra) {
      return toolResult(
        await getApiV1('appointments', params(input), authInfo(extra)),
      )
    },
  },
  {
    name: 'get_appointment',
    title: 'Get appointment',
    description:
      'Get one existing appointment by UUID, including customer, service address, line items, price, technician, America/Denver time window, status, internal notes, visit type, and payment status. Read-only.',
    inputSchema: getByIdInput,
    outputSchema: appointmentDetailOutputSchema,
    async handler({ id }, extra) {
      return toolResult(
        await getApiV1(
          `appointments/${encodeURIComponent(String(id))}`,
          new URLSearchParams(),
          authInfo(extra),
        ),
      )
    },
  },
  {
    name: 'list_unscheduled_appointments',
    title: 'List unscheduled appointments',
    description:
      "List the exact parked-appointment half of Sightings' calendar Unscheduled tray: appointments where parked_at is set, oldest first, with stable customer/conversation references, recorded message context, and Sightings blacklist status. The separate restoration-monitor queue is excluded. Queue membership never proves unresponsiveness or permission for automatic outreach, and a non-blocked result does not verify provider/carrier opt-out state. No messages are sent and no records are changed.",
    inputSchema: listUnscheduledAppointmentsInput,
    outputSchema: unscheduledAppointmentListOutputSchema,
    async handler(input, extra) {
      authInfo(extra)
      return toolResult(
        await listUnscheduledAppointments(
          input as z.infer<typeof listUnscheduledAppointmentsInput>,
        ),
      )
    },
  },
  {
    name: 'list_estimates',
    title: 'List estimates',
    description:
      'List existing estimates, optionally filtered to accepted, pending, or declined. Converted estimates count as accepted; draft and sent estimates count as pending. Results are read-only and paginated.',
    inputSchema: listEstimatesInput,
    outputSchema: estimateListOutputSchema,
    async handler(input, extra) {
      return toolResult(
        await getApiV1('estimates', params(input), authInfo(extra)),
      )
    },
  },
  {
    name: 'get_estimate',
    title: 'Get estimate',
    description:
      'Get one existing estimate by UUID, including its line items, amount, customer, service address, normalized status, and internal notes. Read-only.',
    inputSchema: getByIdInput,
    outputSchema: estimateDetailOutputSchema,
    async handler({ id }, extra) {
      return toolResult(
        await getApiV1(
          `estimates/${encodeURIComponent(String(id))}`,
          new URLSearchParams(),
          authInfo(extra),
        ),
      )
    },
  },
  {
    name: 'search_customers',
    title: 'Search customers',
    description:
      'Search customers by exact normalized phone, case-insensitive email, and/or partial case-insensitive full name. With no filters, returns the most recently updated customers. Results include service addresses and are read-only and paginated.',
    inputSchema: searchCustomersInput,
    outputSchema: customerListOutputSchema,
    async handler(input, extra) {
      return toolResult(
        await getApiV1('customers', params(input), authInfo(extra)),
      )
    },
  },
  {
    name: 'get_availability',
    title: 'Get availability',
    description:
      'Return open technician time slots for one America/Denver date using the live scheduling rules. Each slot assumes a 120-minute appointment including the existing scheduling buffer. Availability is informational, may change, and is not a booking or promise of service.',
    inputSchema: availabilityInput,
    outputSchema: availabilityOutputSchema,
    async handler(input, extra) {
      return toolResult(
        await getApiV1('availability', params(input), authInfo(extra)),
      )
    },
  },
  {
    name: 'list_calls',
    title: 'List inbound calls',
    description:
      'List recent inbound calls and voicemails with stored outcomes, recording URLs, and transcriptions. since accepts an America/Denver date or an ISO 8601 timestamp; when omitted, the REST API uses the preceding seven days. Results are read-only and paginated.',
    inputSchema: callsInput,
    outputSchema: callsOutputSchema,
    async handler(input, extra) {
      return toolResult(await getApiV1('calls', params(input), authInfo(extra)))
    },
  },
  {
    name: 'get_capability_catalog',
    title: 'Get MCP capability catalog',
    description:
      'Describe exactly which Sasquatch business workflows this MCP server can read, their limitations, and which consequential actions are deliberately not exposed. Use this before planning an operation; tool availability is not authorization to contact customers, book work, or make financial commitments.',
    inputSchema: noInput,
    outputSchema: capabilityCatalogOutputSchema,
    async handler(_input, extra) {
      authInfo(extra)
      return toolResult(getCapabilityCatalog())
    },
  },
  {
    name: 'get_business_configuration',
    title: 'Get business configuration',
    description:
      'Read the current America/Denver timezone, service-area ZIP tiers, travel charge, weekly business hours, dated availability overrides, service catalog pricing, durations, and buffers. Configuration is reference data; it does not quote, reserve, or book service. generated_at is retrieval time, not proof that an external integration synchronized.',
    inputSchema: noInput,
    outputSchema: businessConfigurationOutputSchema,
    async handler(_input, extra) {
      authInfo(extra)
      return toolResult(await getBusinessConfiguration())
    },
  },
  {
    name: 'search_business_records',
    title: 'Search business records',
    description:
      'Find compact references to customers and their linked appointments, estimates, invoices, and conversations. Search can also resolve a record UUID or invoice number. Results include stable IDs and Sightings app links, omit message bodies, and never mutate records.',
    inputSchema: businessSearchInput,
    outputSchema: businessSearchOutputSchema,
    async handler(input, extra) {
      authInfo(extra)
      return toolResult(
        await searchBusinessRecords(
          input as z.infer<typeof businessSearchInput>,
        ),
      )
    },
  },
  {
    name: 'get_operational_summary',
    title: 'Get operational attention queues',
    description:
      'Read bounded operational queues for unread customer messages, missed calls, pending estimates, unassigned jobs, failed notifications, service concerns, overdue customer-requested reminders, and collectible-status unpaid invoices. Every queue declares its own time window and every response reports retrieval time plus missing/partial sources. Scheduling conflicts are never guessed.',
    inputSchema: operationalSummaryInput,
    outputSchema: operationalSummaryOutputSchema,
    async handler(input, extra) {
      authInfo(extra)
      return toolResult(
        await getOperationalSummary(
          input as z.infer<typeof operationalSummaryInput>,
        ),
      )
    },
  },
  {
    name: 'list_conversations',
    title: 'List customer conversations',
    description:
      'List real Sightings customer conversation threads with stable IDs, customer context, unread counts, last-message context, filters, and limit/offset pagination. Read-only; does not mark threads read.',
    inputSchema: conversationListInput,
    outputSchema: conversationListOutputSchema,
    async handler(input, extra) {
      authInfo(extra)
      return toolResult(
        await listConversations(input as z.infer<typeof conversationListInput>),
      )
    },
  },
  {
    name: 'get_conversation',
    title: 'Get customer conversation',
    description:
      'Read one Sightings conversation by stable UUID with paginated message bodies, customer context, current saved draft, and owner-authorized short-lived URLs for retained inbound media. Media remains in existing private storage; this tool creates no new retention.',
    inputSchema: conversationDetailInput,
    outputSchema: conversationDetailOutputSchema,
    async handler(input, extra) {
      authInfo(extra)
      return toolResult(
        await getConversation(input as z.infer<typeof conversationDetailInput>),
      )
    },
  },
  {
    name: 'get_invoice',
    title: 'Get invoice detail',
    description:
      'Read one existing invoice with customer, service address, appointment, technician, line items, totals, workflow status, payment status, and timestamps. Does not publish, send, charge, refund, or record payment.',
    inputSchema: getByIdInput,
    outputSchema: invoiceDetailOutputSchema,
    async handler({ id }, extra) {
      authInfo(extra)
      return toolResult(await getInvoice(String(id)))
    },
  },
  {
    name: 'save_conversation_draft',
    title: 'Save customer reply draft',
    description:
      'Create or replace the authorized owner’s saved Sightings reply draft for one conversation. This writes a draft only and never contacts the customer. Requires the separate communications:draft grant.',
    inputSchema: saveConversationDraftInput,
    outputSchema: savedConversationDraftOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await saveConversationDraft(
          input as z.infer<typeof saveConversationDraftInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'preview_customer_update',
    title: 'Preview customer or address update',
    description:
      'Prepare an exact, expiring preview of allowlisted customer and service-address changes. No customer record is changed until execute_customer_update is called with this preview after action-time confirmation.',
    inputSchema: previewCustomerUpdateInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewCustomerUpdate(
          input as z.infer<typeof previewCustomerUpdateInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_customer_update',
    title: 'Execute confirmed customer update',
    description:
      'Execute one unexpired customer/address preview. A matching direct owner instruction is sufficient authorization; do not ask the same question again. Revalidates record versions, preserves blacklist linkage, queues address geocoding when needed, audits the result, and is idempotent.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'customer.update',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_customer_message',
    title: 'Preview customer SMS or MMS',
    description:
      'Prepare an exact, expiring preview showing the conversation, recipient, retained business sender, complete body, and selected existing media. This does not contact the customer.',
    inputSchema: previewConversationSendInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewConversationSend(
          input as z.infer<typeof previewConversationSendInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_customer_message',
    title: 'Send confirmed customer SMS or MMS',
    description:
      'Send one authorized preview through Twilio from the original retained business number when available, then append the provider-confirmed result to Sightings. A matching direct owner instruction or a routine factual reply allowed by the server operating policy is sufficient; use one native client approval if shown and do not add a second conversational confirmation. Never uses Telegram bot posts as a send path. Requires customer:contact.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: customerContactAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'conversation.send',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_appointment_create',
    title: 'Preview appointment booking',
    description:
      'Validate and price a service booking with the existing catalog, service-area, minimum-charge, technician-priority, duration, buffer, and availability rules. Returns the exact appointment, draft-invoice, customer-contact, staff-notification, and QuickBooks effects. Writes nothing.',
    inputSchema: previewAppointmentCreateInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: financialActionAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewAppointmentCreate(
          input as z.infer<typeof previewAppointmentCreateInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_appointment_create',
    title: 'Execute confirmed appointment booking',
    description:
      'Execute one authorized, unexpired booking preview. A matching direct owner instruction or the customer’s explicit acceptance of the exact Sightings-supplied slot, services, and price is sufficient; do not ask the same question again. Revalidates catalog, service area, pricing, minimum, technician, and live availability; then creates the appointment and draft invoice. Customer contact occurs only when the preview explicitly requested it.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: financialActionAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'appointment.create',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_appointment_update',
    title: 'Preview appointment change',
    description:
      'Prepare an exact, expiring preview for a single appointment reschedule, technician reassignment, note edit, or cancellation. Shows before/after values and whether the existing customer communication workflow was requested. Does not change the appointment.',
    inputSchema: previewAppointmentUpdateInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewAppointmentUpdate(
          input as z.infer<typeof previewAppointmentUpdateInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_appointment_update',
    title: 'Execute confirmed appointment change',
    description:
      'Execute one authorized appointment preview with stale-record protection and live staff-calendar revalidation. A matching direct owner instruction, or the customer’s explicit acceptance of the exact schedule change, is sufficient; do not ask the same question again. Can reschedule, reassign, edit notes, or cancel/park one job. Customer notification sending remains blocked until its route-local senders are extracted into the shared confirmed-action service.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: cancellationAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'appointment.update',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_estimate_save',
    title: 'Preview draft estimate save',
    description:
      'Prepare an exact, expiring preview to create or revise one Sightings draft estimate and its line items. Does not send, accept, decline, convert, book, publish an invoice, or contact the customer.',
    inputSchema: previewEstimateSaveInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewEstimateSave(
          input as z.infer<typeof previewEstimateSaveInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_estimate_save',
    title: 'Execute confirmed draft estimate save',
    description:
      'Create or revise one authorized draft estimate with stale-record protection, structured line items, an audit entry, and no customer contact. A matching direct owner instruction is sufficient; do not ask the same question again. Sending and conversion remain separate actions.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'estimate.save',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_estimate_decision',
    title: 'Preview estimate acceptance or decline',
    description:
      'Prepare an exact, expiring preview to mark one unconverted estimate accepted or declined. This records a business status only; it does not impersonate a customer response, contact anyone, book work, convert the estimate, or create an invoice.',
    inputSchema: previewEstimateDecisionInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewEstimateDecision(
          input as z.infer<typeof previewEstimateDecisionInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_estimate_decision',
    title: 'Execute confirmed estimate acceptance or decline',
    description:
      'Execute one authorized estimate-status preview with stale-record and converted-estimate protection. A matching direct owner instruction is sufficient; do not ask the same question again. Records the status history and does not contact the customer or owner.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'estimate.decision',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_estimate_send',
    title: 'Preview estimate email delivery',
    description:
      'Prepare the exact recipient, subject, body, total, signed 30-day accept link, status transition, and reopening reason for one estimate email. Enforces existing opt-out/blacklist suppression and does not send during preview.',
    inputSchema: previewEstimateSendInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: customerContactAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewEstimateSend(
          input as z.infer<typeof previewEstimateSendInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_estimate_send',
    title: 'Send confirmed estimate email',
    description:
      'Send one authorized estimate preview through the existing Resend/template/decision-token workflow. A matching direct owner instruction is sufficient; use one native client approval if shown and do not add a second conversational confirmation. Revalidates recipient, suppression, status, total, record version, and email fingerprint; provider idempotency prevents duplicate email sends.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: customerContactAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'estimate.send',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'preview_estimate_conversion',
    title: 'Preview estimate conversion',
    description:
      'Prepare an exact, expiring preview to turn one unconverted estimate into booked work. Reuses the existing duration, buffer, staff-calendar, line-item, draft-invoice, communications, and QuickBooks behavior. It does not mutate data or contact anyone during preview.',
    inputSchema: previewEstimateConversionInput,
    outputSchema: actionPreviewOutputSchema,
    annotations: financialActionAnnotations,
    async handler(input, extra) {
      return toolResult(
        await previewEstimateConversion(
          input as z.infer<typeof previewEstimateConversionInput>,
          actorInfo(extra),
        ),
      )
    },
  },
  {
    name: 'execute_estimate_conversion',
    title: 'Execute confirmed estimate conversion',
    description:
      'Execute one authorized conversion preview. A matching direct owner instruction or the customer’s explicit acceptance of the exact estimate and schedule is sufficient; do not ask the same question again. The estimate lock, service appointment, copied measurements, draft invoice and lines, status histories, and final converted state commit atomically. Customer communication is off by default and only runs after commit when explicitly previewed.',
    inputSchema: executeConfirmedActionInput,
    outputSchema: actionExecutionOutputSchema,
    annotations: financialActionAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executePreparedAction(
          {
            ...(input as z.infer<typeof executeConfirmedActionInput>),
            expected_action_type: 'estimate.convert',
          },
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'get_schedule_gaps',
    title: 'Read exact-duration schedule gaps',
    description:
      'Read real staff/calendar gaps for a complete job duration, with internal gaps prioritized and protected neighboring appointments. Travel remains inside scheduled blocks. Customer-requested alternate available times remain allowed. No writes, holds or bookings.',
    inputSchema: scheduleGapsInput,
    outputSchema: gapOutput,
    async handler(input) {
      return toolResult(
        await readScheduleGaps(
          createAdminClient(),
          scheduleGapsInput.parse(input),
        ),
      )
    },
  },
  {
    name: 'get_gap_candidates',
    title: 'Read ranked past-customer candidates',
    description:
      'Read oldest-service-first candidates for one current gap, with history provenance, prior duration, route ZIP review, consent evidence, contact history across recorded channels, exclusions and owner-review needs. No campaign or consent records are created.',
    inputSchema: gapCandidatesInput,
    outputSchema: gapRecordsOutput,
    async handler(input) {
      const value = gapCandidatesInput.parse(input)
      return toolResult({
        result: await readGapCandidates(
          createAdminClient(),
          value.gap,
          value.limit,
        ),
      })
    },
  },
  {
    name: 'get_gap_outreach',
    title: 'Read gap outreach state',
    description:
      'Read one bounded batch, provider acceptance and uncertainty, suppressed recipients, stop reasons and booking linkage. Does not resume or send.',
    inputSchema: gapBatchInput,
    outputSchema: gapRecordsOutput,
    async handler(input) {
      return toolResult({
        result: await readGapOutreach(
          createAdminClient(),
          gapBatchInput.parse(input).batch_id,
        ),
      })
    },
  },
  {
    name: 'preview_gap_outreach',
    title: 'Preview one exact gap outreach batch',
    description:
      'Prepare an actor-bound ten-minute approval for one to five named eligible customers, exact generated TF35 offer messages, gap/calendar version and no automatic substitutes. Writes approval rows only; never creates consent or sends. Requires outreach:write and customer:contact; never infer campaign authority from a general task.',
    inputSchema: gapPreviewInput,
    outputSchema: gapRecordsOutput,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await previewGapOutreach(
          createAdminClient(),
          gapPreviewInput.parse(input),
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'execute_gap_outreach',
    title: 'Execute an owner-approved bounded batch',
    description:
      'Execute only the exact explicitly approved recipient/message/gap snapshot. Separate activation and grants are required. Atomically claims sends, revalidates live availability/eligibility, stops pending work after replies, owner takeover or bookings, and never retries uncertain provider outcomes. An in-flight SMS cannot be recalled.',
    inputSchema: gapExecuteInput,
    outputSchema: gapRecordsOutput,
    annotations: customerContactAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await executeGapOutreach(
          createAdminClient(),
          gapExecuteInput.parse(input).confirmation_id,
          actorInfo(extra),
        ),
      })
    },
  },
  {
    name: 'stop_gap_outreach',
    title: 'Stop pending gap outreach',
    description:
      'On the owner instruction, stop remaining pending invitations and hand the batch to the owner. Does not recall already accepted or in-flight messages. Requires outreach:write.',
    inputSchema: gapBatchInput,
    outputSchema: gapRecordsOutput,
    annotations: stateChangeAnnotations,
    async handler(input, extra) {
      return toolResult({
        result: await stopGapOutreach(
          createAdminClient(),
          gapBatchInput.parse(input).batch_id,
          actorInfo(extra),
        ),
      })
    },
  },
]

assertMcpToolCatalog(toolDefinitions.map((tool) => tool.name))

export function createSasquatchMcpServer(): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
  )

  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations ?? annotations,
        _meta: { securitySchemes },
      },
      (input, extra) => tool.handler(input as Record<string, unknown>, extra),
    )
  }

  // OpenAI clients consume the canonical securitySchemes extension while
  // older clients read its compatibility mirror in _meta.
  server.server.setRequestHandler('tools/list', () => ({
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema, {
        target: 'draft-7',
      }) as { type: 'object'; [key: string]: unknown },
      outputSchema: z.toJSONSchema(tool.outputSchema, {
        target: 'draft-7',
      }) as { type: 'object'; [key: string]: unknown },
      annotations: tool.annotations ?? annotations,
      securitySchemes,
      _meta: { securitySchemes },
    })),
  }))

  return server
}

export function mcpAuthenticationErrorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${MCP_RESOURCE_METADATA}", error="insufficient_scope", error_description="OAuth authorization is required"`,
      ],
    },
  }
}
