import { z } from 'zod'
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) &&
      new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v,
    'Use a real date',
  )
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/)
const anchor = z
  .object({
    id: z.string().uuid(),
    zip: z.string().nullable(),
    location: z
      .object({
        city: z.string(),
        street: z.string(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .nullable()
export const gapSchema = z
  .object({
    date,
    staff_id: z.string().uuid(),
    staff_name: z.string(),
    start_time: time,
    end_time: time,
    minutes: z.number().int().min(30).max(1440),
    internal: z.boolean(),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    before: anchor,
    after: anchor,
    slots: z.array(z.object({ start_time: time, end_time: time }).strict()),
  })
  .strict()
export const scheduleGapsInput = z
  .object({
    start_date: date,
    end_date: date,
    required_minutes: z.number().int().min(30).max(240),
    staff_id: z.string().uuid().optional(),
    requested_start_time: time.optional(),
  })
  .strict()
export const gapCandidatesInput = z
  .object({
    gap: gapSchema,
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict()
export const gapBatchInput = z.object({ batch_id: z.string().uuid() }).strict()
export const gapPreviewInput = z
  .object({
    gap: gapSchema,
    customer_ids: z.array(z.string().uuid()).min(1).max(5),
    idempotency_key: z.string().min(8).max(200),
  })
  .strict()
export const gapExecuteInput = z
  .object({ confirmation_id: z.string().uuid(), confirmed: z.literal(true) })
  .strict()
export const gapOutput = z
  .object({
    data: z.array(gapSchema),
    freshness: z
      .object({
        generated_at: z.string(),
        timezone: z.literal('America/Denver'),
        partial: z.boolean(),
        missing: z.array(z.string()),
      })
      .strict(),
    priority: z.literal('internal_gaps_first'),
    alternate_times_allowed: z.literal(true),
  })
  .strict()
// Detailed bounded records preserve provenance; unknown fields are explicit JSON data, never code.
export const gapRecordsOutput = z
  .object({ result: z.record(z.string(), z.unknown()) })
  .strict()
