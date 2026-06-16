/**
 * Harry (next) — execution planner.
 *
 * Given the job's real line-item rows (with their database IDs) and a typed
 * intent, this computes exactly what the executor must write: which single row
 * to delete, the lines that remain, the new total, and the new end time. It is
 * pure — the actual database writes live in a thin layer that consumes this and
 * runs only AFTER the owner approves the pending action.
 *
 * Because removal is expressed as "delete this one row id," there is no
 * full-array rebuild and nothing the model can collapse. The kept lines are the
 * original rows, untouched.
 */
import { recomputeEndTime } from './schedule'
import { planRemoveService, type LineItem } from './service-edit'
import type { RemoveServiceIntent } from './intents'

/** A line item as it exists in the database (carries its row id). */
export type ExistingAppointmentLine = LineItem & { id: string }

export type RemovalExecution =
  | {
      status: 'ready'
      deleteAppointmentLineItemId: string
      keptLines: ExistingAppointmentLine[]
      newQuotedTotal: number
      newEndTime: string
      belowMinimum: boolean
      removedName: string
    }
  | { status: 'not_found'; match: string }
  | { status: 'ambiguous'; match: string; candidates: string[] }

export function planRemovalExecution(params: {
  startTime: string
  appointmentLines: ExistingAppointmentLine[]
  intent: RemoveServiceIntent
}): RemovalExecution {
  const plan = planRemoveService(params.appointmentLines, params.intent)

  if (plan.status === 'not_found') {
    return { status: 'not_found', match: plan.match }
  }
  if (plan.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      match: plan.match,
      candidates: plan.candidates,
    }
  }

  return {
    status: 'ready',
    deleteAppointmentLineItemId: plan.removed.id,
    keptLines: plan.newLines,
    newQuotedTotal: plan.newTotal,
    newEndTime: recomputeEndTime(params.startTime, plan.newTotal),
    belowMinimum: plan.belowMinimum,
    removedName: plan.removed.nameSnapshot,
  }
}
