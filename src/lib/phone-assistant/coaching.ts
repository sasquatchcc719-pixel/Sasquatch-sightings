import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

export const issueKeys = [
  'earliest_opening',
  'repeat_question',
  'early_source',
  'lookup_wait',
  'wordy_reply',
  'unwanted_offer',
  'other',
] as const
export type IssueKey = (typeof issueKeys)[number]

// Only these staff-authored reminders can reach the live agent.
export const coachingTopics: Record<
  IssueKey,
  { label: string; reminder: string }
> = {
  earliest_opening: {
    label: 'Earliest opening',
    reminder:
      'When someone says “whenever you can get here,” run the forward calendar search with their latest quoted services and offer the first verified time.',
  },
  repeat_question: {
    label: 'Repeated intake question',
    reminder:
      'Before asking a question, check whether the caller already supplied the answer. Ask only for the one missing detail.',
  },
  early_source: {
    label: 'Lead source asked too early',
    reminder:
      'Start with the work, quote and availability. Save “How did you hear about us?” for the final pricing check.',
  },
  lookup_wait: {
    label: 'Unexplained wait',
    reminder:
      'When starting a longer lookup, say “Just a moment” once and start the tool in that turn. Give the answer when it returns.',
  },
  wordy_reply: {
    label: 'Reply ran long',
    reminder:
      'Answer the specific question in a short sentence, then give the caller the floor.',
  },
  unwanted_offer: {
    label: 'Repeated or unwanted offer',
    reminder:
      'If the caller declines extras or chooses a message, accept that choice the first time.',
  },
  other: { label: 'Needs investigation', reminder: '' },
}
const findingSchema = z.object({
  key: z.enum(issueKeys),
  sequence: z.number().int().nonnegative(),
  note: z.string().max(300),
})
const reviewSchema = z.object({
  findings: z.array(findingSchema).max(5),
  partial: z.boolean(),
})
export type CallReview = z.infer<typeof reviewSchema>
export function parseReview(value: unknown): CallReview | null {
  const result = reviewSchema.safeParse(value)
  return result.success ? result.data : null
}

export function activeCoaching(
  rows: {
    call_sid: string
    coaching_review: unknown
    coaching_excluded: boolean
  }[],
) {
  const counts = new Map<IssueKey, Set<string>>()
  for (const row of rows) {
    if (row.coaching_excluded) continue
    for (const finding of parseReview(row.coaching_review)?.findings ?? []) {
      if (!coachingTopics[finding.key].reminder) continue
      const calls = counts.get(finding.key) ?? new Set()
      calls.add(row.call_sid)
      counts.set(finding.key, calls)
    }
  }
  return Array.from(counts, ([key, calls]) => ({ key, calls: calls.size }))
    .filter((t) => t.calls >= 2)
    .sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key))
    .slice(0, 3)
}

export async function getActiveCoaching(
  db: SupabaseClient,
  signal?: AbortSignal,
) {
  let query = db
    .from('phone_assistant_sessions')
    .select('call_sid,coaching_review,coaching_excluded')
    .not('coaching_review', 'is', null)
    .order('started_at', { ascending: false })
    .order('call_sid')
    .limit(20)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw error
  return activeCoaching(data ?? [])
}

export async function coachingInstructions(db: SupabaseClient) {
  try {
    const active = await getActiveCoaching(db, AbortSignal.timeout(900))
    return active.length
      ? '\nConversation reminders from recent call reviews:\n' +
          active.map((t) => coachingTopics[t.key].reminder).join('\n')
      : ''
  } catch {
    console.warn('[Phone assistant] Recent call coaching unavailable')
    return ''
  }
}

export async function getCallReview(db: SupabaseClient, callSid: string) {
  const { data, error } = await db
    .from('phone_assistant_sessions')
    .select('coaching_review,coaching_excluded')
    .eq('call_sid', callSid)
    .single()
  if (error) throw error
  return {
    review: parseReview(data.coaching_review),
    excluded: data.coaching_excluded === true,
  }
}
