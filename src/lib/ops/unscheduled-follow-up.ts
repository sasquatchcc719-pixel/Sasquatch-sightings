import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export const followUpDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'Use a valid calendar date')

export const saveUnscheduledFollowUpInput = z
  .object({
    appointment_id: z.string().uuid(),
    next_follow_up_date: followUpDateSchema,
    expected_updated_at: z.string().datetime({ offset: true }),
    review_note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()

export const unscheduledFollowUpSchema = z
  .object({
    next_follow_up_date: z.string(),
    due: z.boolean(),
    reviewed_at: z.string().nullable(),
    review_note: z.string().nullable(),
    updated_at: z.string(),
  })
  .strict()

export type UnscheduledFollowUp = z.infer<typeof unscheduledFollowUpSchema>
type Row = Omit<UnscheduledFollowUp, 'due'> & { resolved_at?: string | null }

export function projectUnscheduledFollowUp(
  value: Row | Row[] | null | undefined,
  now = new Date(),
): UnscheduledFollowUp | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || row.resolved_at) return null
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  return {
    next_follow_up_date: row.next_follow_up_date,
    due: row.next_follow_up_date <= today,
    reviewed_at: row.reviewed_at,
    review_note: row.review_note,
    updated_at: row.updated_at,
  }
}

/** Only internal task metadata changes. This never contacts a customer or changes a job. */
export async function saveUnscheduledFollowUp(
  db: SupabaseClient,
  value: z.infer<typeof saveUnscheduledFollowUpInput>,
  actorId: string,
) {
  const input = saveUnscheduledFollowUpInput.parse(value)
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Denver',
  })
  if (input.next_follow_up_date < today)
    throw new Error('Choose today or a future follow-up date')
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('ops_unscheduled_follow_ups')
    .update({
      next_follow_up_date: input.next_follow_up_date,
      updated_at: now,
      ...(input.review_note
        ? {
            reviewed_at: now,
            review_note: input.review_note,
            reviewed_by: actorId,
          }
        : {}),
    })
    .eq('appointment_id', input.appointment_id)
    .eq('updated_at', input.expected_updated_at)
    .is('resolved_at', null)
    .select('next_follow_up_date, reviewed_at, review_note, updated_at')
    .maybeSingle()
  if (error) throw error
  if (!data)
    throw new Error(
      'Follow-up changed or the job was rescheduled. Refresh before saving.',
    )
  return projectUnscheduledFollowUp(data)!
}
