import type { SupabaseClient } from '@supabase/supabase-js'
import { utilizationHoursFromAppointment } from '@/lib/ops/utilization-metrics'

/**
 * A monitor is an hour of labour, whatever the calendar says.
 *
 * Charles, on the Benns loss: *"the mitigation was about six hours of labor
 * and each monitor was about an hour. I think we standardize a monitor to one
 * hour of labor."* Monitors get dropped onto whatever two-hour slot fits the
 * day, so the booked slot measures scheduling convenience, not work. The
 * mitigation day is the opposite — it runs as long as it runs.
 */
export const MONITOR_LABOR_HOURS = 1

type LabourVisit = {
  visit_type?: string | null
  status?: string | null
  start_time?: string | null
  end_time?: string | null
  on_my_way_at?: string | null
  completed_at?: string | null
}

/** The labour one visit represents, under Charles's rule. */
export function visitLaborHours(visit: LabourVisit): number {
  if (visit.status === 'cancelled') return 0
  // Everything that is not the mitigation day is a monitoring trip: the
  // 'final' visit is the one where the equipment comes out, which is a monitor
  // by any other name.
  if (visit.visit_type !== 'mitigation') return MONITOR_LABOR_HOURS
  return utilizationHoursFromAppointment(visit)
}

/**
 * The labour a water loss actually took, across every visit on it.
 *
 * A carpet job is one appointment and one invoice, so the appointment's own
 * hours are the job's hours. A water loss is not: it is a mitigation day plus
 * however many monitors, invoiced once at the close, with the revenue entry
 * hanging off the closing visit. Reading that visit alone booked the Benns
 * flood — six hours of demolition and three monitors — as two hours, and
 * credited the whole $4,052.46 to the tech who did the equipment pickup.
 *
 * Pairs with the restoration branch in `loadUtilizationSupplementRows`, which
 * would otherwise re-count these same visits on top of the entry. Hours here,
 * coverage there — change one and check the other.
 */
export async function restorationLaborHours(
  supabase: SupabaseClient,
  projectId: string,
): Promise<number> {
  const { data: visits, error } = await supabase
    .from('ops_appointments')
    .select(
      'id, visit_type, status, start_time, end_time, on_my_way_at, completed_at',
    )
    .eq('restoration_project_id', projectId)

  // A swallowed error here reads as zero hours, and zero silently falls back
  // to the old single-visit behaviour — the bug this function exists to fix.
  if (error) {
    console.error('[restorationLaborHours]', error)
    throw error
  }

  const total = (visits ?? []).reduce((sum, v) => sum + visitLaborHours(v), 0)

  // hours_worked is numeric(6,2); an overflow fails the insert and drops the
  // whole loss out of stats without saying so.
  return Math.min(Math.round(total * 100) / 100, 9999)
}
