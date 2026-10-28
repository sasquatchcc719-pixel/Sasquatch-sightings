import { unscheduledFollowUpSchema } from '@/lib/ops/unscheduled-follow-up'
import { z } from 'zod'
import {
  commercialWorkspaceStatusSchema,
  commercialWorkspaceControlsSchema,
} from './commercial-schemas'

const nullableString = z.string().nullable()
const nullableNumber = z.number().finite().nullable()

export const paginationSchema = z
  .object({
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict()

export const customerSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    business_name: nullableString,
    phone: nullableString,
    email: nullableString,
    notes: nullableString.optional(),
  })
  .strict()
  .nullable()

export const addressSchema = z
  .object({
    id: z.string(),
    label: nullableString,
    street_1: nullableString,
    street_2: nullableString,
    city: nullableString,
    state: nullableString,
    zip_code: nullableString,
    gate_code: nullableString.optional(),
    notes: nullableString.optional(),
  })
  .strict()
  .nullable()

export const technicianSchema = z
  .object({ id: z.string(), name: z.string() })
  .strict()
  .nullable()

export const timeWindowSchema = z
  .object({
    date: z.string(),
    start_time: nullableString,
    end_time: nullableString,
    timezone: z.literal('America/Denver'),
  })
  .strict()

export const lineItemSchema = z
  .object({
    id: z.string(),
    service_id: nullableString,
    name: nullableString,
    quantity: nullableNumber,
    unit_price: nullableNumber,
    amount: nullableNumber,
    duration_minutes: z.number().int().nullable(),
    notes: nullableString,
  })
  .strict()

const conversationMessageSchema = z
  .object({
    id: z.string(),
    direction: z.enum(['inbound', 'outbound']),
    content: z.string(),
    timestamp: nullableString,
    sent_by: nullableString,
    provider_message_id: nullableString,
  })
  .strict()

export const appointmentSummarySchema = z
  .object({
    id: z.string(),
    customer: customerSchema,
    address: addressSchema,
    tech: technicianSchema,
    time_window: timeWindowSchema,
    status: z.enum(['scheduled', 'completed', 'cancelled']),
    price: nullableNumber,
  })
  .strict()

export const appointmentDetailSchema = appointmentSummarySchema.extend({
  customer: customerSchema,
  address: addressSchema,
  services: z.array(lineItemSchema),
  notes: nullableString,
  visit_type: nullableString,
  payment_status: nullableString,
})

export const estimateSummarySchema = z
  .object({
    id: z.string(),
    customer: customerSchema,
    address: addressSchema,
    amount: nullableNumber,
    status: z.enum(['accepted', 'pending', 'declined']),
    time_window: timeWindowSchema,
  })
  .strict()

export const estimateDetailSchema = z
  .object({
    id: z.string(),
    line_items: z.array(lineItemSchema),
    amount: nullableNumber,
    customer: customerSchema,
    address: addressSchema,
    status: z.enum(['accepted', 'pending', 'declined']),
    notes: nullableString,
  })
  .strict()

export const customerSearchResultSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    first_name: nullableString,
    last_name: nullableString,
    business_name: nullableString,
    phone: nullableString,
    email: nullableString,
    notes: nullableString,
    addresses: z.array(addressSchema),
  })
  .strict()

export const availabilitySlotSchema = z
  .object({
    start_time: z.string(),
    end_time: z.string(),
    technicians: z.array(
      z.object({ id: z.string(), name: z.string() }).strict(),
    ),
  })
  .strict()

export const callSchema = z
  .object({
    id: z.string(),
    call_sid: nullableString,
    caller_phone: nullableString,
    outcome: nullableString,
    duration_seconds: z.number().int().nonnegative().nullable(),
    recording_url: nullableString,
    transcription: nullableString,
    created_at: z.string(),
  })
  .strict()

export const appointmentListOutputSchema = z
  .object({
    data: z.array(appointmentSummarySchema),
    pagination: paginationSchema,
  })
  .strict()

export const appointmentDetailOutputSchema = z
  .object({ data: appointmentDetailSchema })
  .strict()

export const unscheduledAppointmentListOutputSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          queue_reason: z.literal('parked_for_rescheduling'),
          parked_at: z.string(),
          follow_up: unscheduledFollowUpSchema.nullable(),
          status: z.string(),
          kind: nullableString,
          last_scheduled_time_window: timeWindowSchema,
          duration_minutes: z.number().int().positive(),
          price: nullableNumber,
          notes: nullableString,
          customer: z
            .object({
              id: z.string(),
              name: nullableString,
              phone: nullableString,
              email: nullableString,
            })
            .strict()
            .nullable(),
          address: addressSchema,
          tech: technicianSchema,
          services: z.array(
            z
              .object({
                id: z.string(),
                name: nullableString,
                quantity: nullableNumber,
                amount: nullableNumber,
                duration_minutes: z.number().int().nullable(),
              })
              .strict(),
          ),
          contact_controls: z
            .object({
              sms: z
                .object({
                  status: z.enum([
                    'blocked_by_sightings',
                    'not_blocked_by_sightings',
                    'unknown',
                  ]),
                  source: z.literal('Sightings blacklist'),
                  reason: nullableString,
                })
                .strict(),
              email_opt_out: z.boolean(),
            })
            .strict(),
          conversation: z
            .object({
              id: z.string(),
              match_basis: z.enum(['customer_id', 'unlinked_phone']),
              status: z.string(),
              source: nullableString,
              latest_message: conversationMessageSchema.nullable(),
              latest_inbound_message: conversationMessageSchema.nullable(),
              latest_inbound_after_parking:
                conversationMessageSchema.nullable(),
              inbound_after_parking: z.enum(['yes', 'no']),
              updated_at: z.string(),
              app_url: z.string(),
            })
            .strict()
            .nullable(),
          follow_up_assessment: z
            .object({
              automatic_outreach_eligibility: z.literal('not_determined'),
              needs_conversation_review: z.literal(true),
              explanation: z.string(),
            })
            .strict(),
          created_at: z.string(),
          updated_at: z.string(),
          app_url: z.string(),
        })
        .strict(),
    ),
    pagination: paginationSchema,
    semantics: z
      .object({
        source: z.string(),
        criterion: z.literal('ops_appointments.parked_at IS NOT NULL'),
        order: z.string(),
        restoration_monitor_visits_included: z.literal(false),
        note: z.string(),
        contact_controls_note: z.string(),
      })
      .strict(),
    follow_up_tracking: z
      .object({ available: z.literal(true), reason: z.string() })
      .strict(),
  })
  .strict()

export const estimateListOutputSchema = z
  .object({
    data: z.array(estimateSummarySchema),
    pagination: paginationSchema,
  })
  .strict()

export const estimateDetailOutputSchema = z
  .object({ data: estimateDetailSchema })
  .strict()

export const customerListOutputSchema = z
  .object({
    data: z.array(customerSearchResultSchema),
    pagination: paginationSchema,
  })
  .strict()

export const availabilityOutputSchema = z
  .object({
    date: z.string(),
    timezone: z.literal('America/Denver'),
    duration_minutes: z.literal(120),
    data: z.array(availabilitySlotSchema),
    pagination: paginationSchema,
  })
  .strict()

export const callsOutputSchema = z
  .object({
    data: z.array(callSchema),
    since: z.string(),
    pagination: paginationSchema,
  })
  .strict()

export const capabilityCatalogOutputSchema = z
  .object({
    generated_at: z.string(),
    server: z.object({ name: z.string(), version: z.string() }).strict(),
    commercial_workspace: commercialWorkspaceStatusSchema
      .extend({ controls: commercialWorkspaceControlsSchema })
      .optional(),
    operating_policy: z
      .object({
        objective: z.string(),
        direct_instruction: z.string(),
        standing_authority: z.array(z.string()),
        ask_once_before: z.array(z.string()),
        never_exposed: z.array(z.string()),
        client_confirmation_note: z.string(),
      })
      .strict(),
    capabilities: z.array(
      z
        .object({
          area: z.string(),
          workflows: z.array(z.string()),
          tools: z.array(z.string()),
          access: z.enum(['available', 'partial', 'not_exposed']),
          scope: z.string(),
          side_effects: z.array(z.string()),
          approval: z.string(),
          limitations: z.array(z.string()),
        })
        .strict(),
    ),
    unavailable: z.array(z.string()),
  })
  .strict()

const freshnessSchema = z
  .object({
    generated_at: z.string(),
    timezone: z.literal('America/Denver'),
    partial: z.boolean(),
    missing: z.array(z.string()),
  })
  .strict()

export const businessConfigurationOutputSchema = z
  .object({
    freshness: freshnessSchema,
    timezone: z.literal('America/Denver'),
    service_area: z
      .object({
        description: z.string(),
        standard_zip_codes: z.array(z.string()),
        travel_charge_zip_codes: z.array(z.string()),
        travel_charge_amount: z.number(),
      })
      .strict(),
    business_hours: z.array(z.record(z.string(), z.unknown())),
    availability_overrides: z.array(z.record(z.string(), z.unknown())),
    service_catalog: z.array(z.record(z.string(), z.unknown())),
    scheduling: z
      .object({
        availability_assumption_minutes: z.literal(120),
        booking_effect: z.literal('informational_only'),
      })
      .strict(),
  })
  .strict()

export const businessSearchOutputSchema = z
  .object({
    freshness: freshnessSchema,
    query: z.string(),
    data: z.array(
      z
        .object({
          entity: z.enum([
            'customer',
            'appointment',
            'estimate',
            'invoice',
            'conversation',
          ]),
          id: z.string(),
          label: z.string(),
          subtitle: nullableString,
          status: nullableString,
          updated_at: nullableString,
          matched_on: z.string(),
          app_url: z.string(),
        })
        .strict(),
    ),
    pagination: z
      .object({ limit: z.number().int(), returned: z.number().int() })
      .strict(),
  })
  .strict()

export const operationalSummaryOutputSchema = z
  .object({
    freshness: freshnessSchema,
    window: z.object({ from: z.string(), through: z.string() }).strict(),
    queues: z.array(
      z
        .object({
          name: z.enum([
            'unanswered_messages',
            'missed_calls',
            'pending_estimates',
            'unassigned_jobs',
            'scheduling_conflicts',
            'failed_notifications',
            'service_concerns',
            'overdue_followups',
            'unpaid_invoices',
          ]),
          count: z.number().int().nonnegative().nullable(),
          status: z.enum(['available', 'partial', 'unavailable']),
          window: z.string(),
          note: nullableString,
          items: z.array(z.record(z.string(), z.unknown())),
        })
        .strict(),
    ),
  })
  .strict()

const conversationCustomerSchema = z
  .object({
    id: z.string(),
    name: nullableString,
    phone: nullableString,
    email: nullableString,
    notes: nullableString.optional(),
  })
  .strict()
  .nullable()

export const conversationListOutputSchema = z
  .object({
    data: z.array(
      z
        .object({
          id: z.string(),
          phone_number: z.string(),
          source: nullableString,
          status: z.string(),
          ai_enabled: z.boolean(),
          customer: conversationCustomerSchema,
          unread_count: z.number().int().nonnegative(),
          last_message: conversationMessageSchema.nullable(),
          created_at: z.string(),
          updated_at: z.string(),
          app_url: z.string(),
        })
        .strict(),
    ),
    pagination: paginationSchema,
  })
  .strict()

export const conversationDetailOutputSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        phone_number: z.string(),
        source: nullableString,
        status: z.string(),
        ai_enabled: z.boolean(),
        customer: conversationCustomerSchema,
        unread_count: z.number().int().nonnegative(),
        messages: z.array(conversationMessageSchema),
        message_pagination: paginationSchema,
        media: z.array(
          z
            .object({
              id: z.string(),
              provider_message_id: z.string(),
              content_type: z.string(),
              byte_size: z.number().nullable(),
              status: z.string(),
              category: z.string(),
              error: nullableString,
              url: nullableString,
              url_expires_at: nullableString,
              created_at: z.string(),
            })
            .strict(),
        ),
        saved_draft: z
          .object({
            id: z.string(),
            body: z.string(),
            status: z.string(),
            created_at: z.string(),
            updated_at: z.string(),
          })
          .strict()
          .nullable(),
        created_at: z.string(),
        updated_at: z.string(),
        app_url: z.string(),
      })
      .strict(),
  })
  .strict()

export const invoiceDetailOutputSchema = z
  .object({
    data: z
      .object({
        id: z.string(),
        invoice_number: z.union([z.string(), z.number()]).nullable(),
        appointment: z.record(z.string(), z.unknown()).nullable(),
        customer: z.record(z.string(), z.unknown()).nullable(),
        address: z.record(z.string(), z.unknown()).nullable(),
        line_items: z.array(z.record(z.string(), z.unknown())),
        subtotal: z.number(),
        discounts: z.number(),
        tax: z.number(),
        minimum_charge_adjustment: z.number(),
        total: z.number(),
        status: z.string(),
        payment_status: nullableString,
        created_at: z.string(),
        updated_at: z.string(),
        app_url: z.string(),
      })
      .strict(),
  })
  .strict()

export const savedConversationDraftOutputSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    effect: z.string(),
  })
  .strict()

export const actionPreviewOutputSchema = z
  .object({
    confirmation_id: z.string().uuid(),
    status: z.string(),
    expires_at: z.string(),
    preview: z.record(z.string(), z.unknown()),
  })
  .strict()

export const actionExecutionOutputSchema = z
  .object({ result: z.record(z.string(), z.unknown()) })
  .strict()
