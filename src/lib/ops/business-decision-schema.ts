import { z } from 'zod'

const windowSchema = z.object({ start: z.string(), end: z.string() }).strict()
const linkSchema = z
  .object({
    label: z.string(),
    url: z.string(),
    record_id: z.string().optional(),
    entity: z.string().optional(),
  })
  .strict()
const totalsSchema = z
  .object({
    completed_visits: z.number().int(),
    invoice_covered_visits: z.number().int(),
    invoiced_value: z.number(),
    marked_paid_value: z.number(),
    quoted_value: z.number(),
    quote_invoice_difference: z.number(),
    missing_invoice_visits: z.number().int(),
    draft_invoice_visits: z.number().int(),
    ambiguous_invoice_visits: z.number().int(),
    consolidated_billing_visits: z.number().int(),
    restoration_visits: z.number().int(),
    warranty_visits: z.number().int(),
    internal_visits: z.number().int(),
  })
  .strict()

export const businessDecisionSnapshotSchema = z
  .object({
    version: z.literal('1'),
    generated_at: z.string(),
    timezone: z.literal('America/Denver'),
    currency: z.literal('USD'),
    read_only: z.literal(true),
    coverage: z
      .object({
        status: z.enum(['complete', 'partial']),
        missing: z.array(z.string()),
        definitions: z.array(z.string()),
      })
      .strict(),
    periods: z
      .object({
        last_week: windowSchema,
        current: windowSchema,
        previous: windowSchema,
        upcoming: windowSchema,
      })
      .strict(),
    performance: z
      .object({
        last_week: totalsSchema,
        current: totalsSchema,
        previous: totalsSchema,
        invoiced_value_change: z.number().nullable(),
        invoiced_value_change_pct: z.number().nullable(),
      })
      .strict()
      .nullable(),
    lead_sources: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          completed_visits: z.number().int(),
          invoice_covered_visits: z.number().int(),
          invoiced_value: z.number(),
          previous_completed_visits: z.number().int(),
          previous_invoice_covered_visits: z.number().int(),
          previous_invoiced_value: z.number(),
          links: z.array(linkSchema),
        })
        .strict(),
    ),
    upcoming: z
      .object({
        scheduled_visits: z.number().int(),
        quoted_value: z.number(),
        unassigned_visits: z.number().int(),
        note: z.string(),
      })
      .strict()
      .nullable(),
    decisions: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          evidence: z.string(),
          next_step: z.string(),
          links: z.array(linkSchema),
        })
        .strict(),
    ),
    queues: z.array(
      z
        .object({
          name: z.string(),
          label: z.string(),
          count: z.number().int().nullable(),
          status: z.enum(['available', 'partial', 'unavailable']),
          window: z.string(),
          note: z.string().nullable(),
          links: z.array(linkSchema),
        })
        .strict(),
    ),
    reconciliation: z.array(
      z
        .object({
          appointment_id: z.string(),
          date: z.string(),
          issue: z.enum([
            'missing_invoice',
            'draft_invoice',
            'ambiguous_invoice',
            'quote_difference',
          ]),
          quote: z.number(),
          invoice: z.number().nullable(),
          links: z.array(linkSchema),
        })
        .strict(),
    ),
  })
  .strict()

export type BusinessDecisionSnapshot = z.infer<
  typeof businessDecisionSnapshotSchema
>
export type DecisionTotals = z.infer<typeof totalsSchema>
