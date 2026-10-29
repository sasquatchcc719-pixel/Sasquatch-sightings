import { z } from 'zod'

const id = z.string().uuid()
const timestamp = z.string().datetime({ offset: true }).max(64)
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, 'Use a real calendar date')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const duration = z.number().int().min(15).max(180)

export const commercialPlaybookInput = z.object({}).strict()
export const commercialEmailAgentStatusInput = z.object({}).strict()
export const commercialEscalationsInput = z
  .object({ limit: z.number().int().min(1).max(50).default(25) })
  .strict()
export const commercialEmailWorkInput = z
  .object({
    filter: z
      .enum([
        'open',
        'draft_ready',
        'inbound',
        'reactivation',
        'prospect',
        'all',
      ])
      .default('open'),
    before: timestamp.optional(),
    limit: z.number().int().min(1).max(50).default(25),
  })
  .strict()
export const commercialAccountListInput = z
  .object({
    filter: z.enum(['all', 'due', 'no_action']).default('all'),
    cursor: z
      .object({ afterId: id, afterAt: z.union([timestamp, z.literal('')]) })
      .strict()
      .optional(),
  })
  .strict()
export const commercialProspectSearchInput = z
  .object({
    source: z.enum(['lead', 'customer']),
    field: z.enum(['name', 'email', 'phone']),
    q: z.string().trim().min(2).max(100),
    after_id: id.optional(),
  })
  .strict()
export const commercialAccountInput = z.object({ account_id: id }).strict()
export const commercialHistoryInput = z
  .object({
    account_id: id,
    before: timestamp.optional(),
    key: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict()
  .refine(
    (input) => Boolean(input.before) === Boolean(input.key),
    'History pagination needs both before and key',
  )
export const commercialAccountCreateInput = z
  .object({
    source: z.enum(['lead', 'customer']),
    source_id: id,
    request_id: id,
  })
  .strict()
export const commercialAccountUpdateInput = z
  .object({
    account_id: id,
    request_id: id,
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    stage: z.enum([
      'researched',
      'contact_identified',
      'conversation',
      'qualified',
      'deferred',
      'lost',
    ]),
    assigned_to: z.string().trim().min(1).max(100),
    next_action: z.string().trim().max(1000),
    next_action_at: timestamp.nullable(),
    brief: z
      .object({
        need: z.string().trim().max(2000),
        buying_roles: z.string().trim().max(2000),
        timing: z.string().trim().max(2000),
        access: z.string().trim().max(2000),
        service_scope: z.string().trim().max(2000),
        evidence: z.string().trim().max(2000),
        unknowns: z.string().trim().max(2000),
      })
      .strict(),
  })
  .strict()
  .refine(
    (input) => Boolean(input.next_action) === Boolean(input.next_action_at),
    'A next action needs a due date and time',
  )
export const commercialCustomerMatchInput = z
  .object({ account_id: id, customer_id: id.optional() })
  .strict()
export const commercialMeasurementSlotsInput = z
  .object({
    account_id: id,
    appointment_date: date,
    visit_duration_minutes: duration.default(60),
  })
  .strict()
const site = z
  .object({
    street_1: z.string().trim().min(1).max(200),
    street_2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.literal('CO'),
    zip_code: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  })
  .strict()
const identity = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('existing'),
      customer_id: id,
      service_address_id: id,
    })
    .strict(),
  z.object({ mode: z.literal('new_site'), customer_id: id, site }).strict(),
  z
    .object({
      mode: z.literal('new_customer'),
      customer: z
        .object({
          business_name: z.string().trim().min(1).max(200),
          contact_name: z.string().trim().min(1).max(200),
          phone: z.string().trim().min(1).max(30),
          email: z.string().trim().email().max(254).optional(),
        })
        .strict(),
      site,
    })
    .strict(),
])
export const commercialMeasurementPreviewInput = z
  .object({
    account_id: id,
    account_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    request: z
      .object({
        identity,
        appointment_date: date,
        start_time: time,
        assigned_staff_user_id: id,
        visit_duration_minutes: duration,
        job_description: z.string().trim().min(1).max(5000),
      })
      .strict(),
  })
  .strict()

// Detailed business records are untrusted evidence. The bridge validates and
// bounds their response size and rejects credentials before exposing them here.
export const commercialWorkspaceControlsSchema = z
  .object({
    emailSendingDisabled: z.literal(true),
    bookingEnabled: z.literal(false),
    mode: z.literal('workspace_and_preview_only'),
  })
  .strict()
export const commercialWorkspaceOutputSchema = z
  .object({
    result: z.record(z.string(), z.unknown()),
    controls: commercialWorkspaceControlsSchema,
  })
  .strict()
export const commercialWorkspaceStatusSchema = z
  .object({
    configured: z.boolean(),
    verified: z.boolean(),
    allowedCapabilities: z.array(z.string()),
    lastSeen: timestamp.nullable(),
  })
  .strict()
