import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  MCP_AUTH_SCOPES,
  MCP_BUSINESS_SCOPE,
  MCP_RESOURCE_METADATA,
} from './constants'
import {
  appointmentDetailOutputSchema,
  appointmentListOutputSchema,
  availabilityOutputSchema,
  businessConfigurationOutputSchema,
  businessSearchOutputSchema,
  callsOutputSchema,
  capabilityCatalogOutputSchema,
  customerListOutputSchema,
  estimateDetailOutputSchema,
  estimateListOutputSchema,
  operationalSummaryOutputSchema,
} from './schemas'
import {
  getBusinessConfiguration,
  getCapabilityCatalog,
  getOperationalSummary,
  searchBusinessRecords,
} from './operations'
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

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const securitySchemes = [
  { type: 'oauth2' as const, scopes: [...MCP_AUTH_SCOPES] },
]

type HandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

function authInfo(extra: HandlerExtra): AuthInfo {
  const info = extra.authInfo
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
  handler: (
    input: Record<string, unknown>,
    extra: HandlerExtra,
  ) => Promise<ReturnType<typeof toolResult>>
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
      'Read the current America/Denver timezone, service-area ZIP tiers, travel charge, weekly business hours, dated availability overrides, service catalog pricing, durations, and buffers. Configuration is reference data; it does not quote, reserve, or book service.',
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
      'Read bounded operational queues for unread customer messages, missed calls, pending estimates, unassigned jobs, failed notifications, service concerns, overdue customer-requested reminders, and unpaid invoices. Every response reports freshness and missing/partial sources. Scheduling conflicts are never guessed.',
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
]

export function createSasquatchMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'sasquatch-sightings-read', version: '1.1.0' },
    {
      instructions:
        'Read-only Sasquatch Carpet Cleaning operations data. Availability is live scheduling capacity for a 120-minute job, not a booking. Never claim that a slot is reserved, never infer missing records or queue states, and treat tool availability as distinct from authorization for any real-world action.',
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
        annotations,
        _meta: { securitySchemes },
      },
      (input, extra) => tool.handler(input as Record<string, unknown>, extra),
    )
  }

  // SDK 1.32 exposes extension metadata through _meta but predates the current
  // top-level securitySchemes type. Replace only tools/list so current OpenAI
  // clients receive both the canonical field and its compatibility mirror.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema, { target: 'draft-7' }),
      outputSchema: z.toJSONSchema(tool.outputSchema, { target: 'draft-7' }),
      annotations,
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
