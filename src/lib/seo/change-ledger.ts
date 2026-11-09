import { z } from 'zod'
import { dateKey } from './reporting'

const day = z.string().refine((value) => {
  try {
    dateKey(value)
    return true
  } catch {
    return false
  }
}, 'Expected a valid YYYY-MM-DD date')
const text = z.string().trim().min(1).max(2000)
const period = z
  .object({ start: day, end: day })
  .strict()
  .refine((p) => p.start <= p.end, 'Period must end on or after its start')
const baseline = z
  .object({
    surface: z.enum(['maps', 'organic', 'business']),
    metric: z.string().trim().min(1).max(120),
    value: z.number().finite().nullable(),
    unit: z.string().trim().min(1).max(80),
    period,
    sourceRef: text,
    method: text,
    state: z.enum(['measured', 'partial', 'failed', 'stale', 'unavailable']),
  })
  .strict()

/** Optional structured evidence on the existing marketing event, never a causal claim. */
export const seoChangeSchema = z
  .object({
    version: z.literal(1),
    hypothesis: text,
    exactChange: text,
    deploymentRef: text.nullable(),
    deployedAt: z.string().datetime({ offset: true }).nullable(),
    affectedUrls: z
      .array(
        z
          .string()
          .url()
          .max(2000)
          .refine(
            (value) => /^https?:\/\//.test(value),
            'Expected an HTTP(S) page URL',
          ),
      )
      .max(50),
    queries: z.array(z.string().trim().min(1).max(300)).max(50),
    baseline: z.array(baseline).max(30),
    reviewDates: z.array(day).min(1).max(12),
    outcomes: z
      .array(
        z
          .object({
            reviewedAt: z.string().datetime({ offset: true }),
            observation: text,
            evidenceRefs: z.array(text).min(1).max(20),
            confounders: z.array(text).max(20),
            interpretation: z.enum([
              'inconclusive',
              'consistent_with_hypothesis',
              'not_consistent_with_hypothesis',
            ]),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((change, ctx) => {
    for (const row of change.baseline) {
      if (row.state === 'measured' && row.value === null)
        ctx.addIssue({
          code: 'custom',
          message: 'Measured baseline requires a value',
          path: ['baseline'],
        })
    }
    if (change.deployedAt) {
      for (const date of change.reviewDates) {
        if (date < change.deployedAt.slice(0, 10))
          ctx.addIssue({
            code: 'custom',
            message: 'Review date precedes deployment',
            path: ['reviewDates'],
          })
      }
    }
  })
export type SeoChange = z.infer<typeof seoChangeSchema>
