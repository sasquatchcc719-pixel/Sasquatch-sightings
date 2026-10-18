import type { SupabaseClient } from '@supabase/supabase-js'
import { timeToMinutes } from './availability'
import {
  planRecurringSchedule,
  type RecurringSchedulePlanInput,
} from './recurring-scheduling'

/** Compare complete plans so the customer keeps one technician throughout the series. */
export async function planBestFitRecurringSchedule(
  supabase: SupabaseClient,
  input: Omit<RecurringSchedulePlanInput, 'staffUserId'> & {
    preferredStaffUserId?: string
  },
) {
  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('id')
    .eq('is_active', true)
    .eq('show_on_calendar', true)
    .order('scheduling_priority', { ascending: true })
  if (error) throw error
  if (!staff?.length)
    throw new Error('No active calendar technicians are available.')
  const candidates = new Map(
    input.candidates.map((candidate) => [candidate.original_date, candidate]),
  )
  const plans = await Promise.all(
    staff.map(async (member) => {
      const plan = await planRecurringSchedule(supabase, {
        ...input,
        staffUserId: member.id,
        schedulingMode: 'flexible',
      })
      const score = [
        plan.occurrences.filter((visit) => visit.status === 'conflict').length,
        plan.occurrences.reduce(
          (sum, visit) =>
            sum +
            Math.abs(
              Date.parse(visit.date) -
                Date.parse(candidates.get(visit.original_date)!.date),
            ) /
              86400000,
          0,
        ),
        plan.occurrences.reduce(
          (sum, visit) =>
            sum +
            Math.abs(
              timeToMinutes(visit.start_time) -
                timeToMinutes(candidates.get(visit.original_date)!.start_time),
            ),
          0,
        ),
        member.id === input.preferredStaffUserId ? 0 : 1,
      ]
      return { plan, score }
    }),
  )
  plans.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) {
      if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i]
    }
    return 0
  })
  return { ...plans[0].plan, best_fit: { technicians_compared: plans.length } }
}
