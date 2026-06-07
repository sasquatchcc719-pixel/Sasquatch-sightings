import {
  isHarryMutationTool,
  type HarryToolOutcome,
  type HarryWorkflowState,
} from './workflow'

export type HarryRecoveryPlan = {
  lookupToolName: 'get_calendar_slots' | 'list_my_upcoming_appointments'
  lookupArgs: Record<string, unknown>
  reason: 'refresh_slot' | 'refresh_appointment'
}

function outcomeError(outcome: HarryToolOutcome): string {
  return String(outcome.error || outcome.result?.error || '').toLowerCase()
}

export function buildHarryRecoveryPlan(
  outcome: HarryToolOutcome,
  state: HarryWorkflowState,
): HarryRecoveryPlan | null {
  if (outcome.success || !isHarryMutationTool(outcome.toolName)) return null
  const error = outcomeError(outcome)

  if (
    ['reschedule_job', 'book_new_job', 'book_commercial_estimate'].includes(
      outcome.toolName,
    ) &&
    (error.includes('slot_token') ||
      error.includes('selected appointment slot') ||
      error.includes('start time is not available'))
  ) {
    const args = outcome.args
    const date = String(
      outcome.toolName === 'reschedule_job'
        ? args.new_appointment_date ||
            state.collected_fields.requested_date ||
            ''
        : args.appointment_date || state.collected_fields.requested_date || '',
    ).trim()
    if (!date) return null
    return {
      lookupToolName: 'get_calendar_slots',
      lookupArgs: {
        date,
        duration_minutes:
          outcome.toolName === 'book_commercial_estimate'
            ? 60
            : state.collected_fields.duration_minutes || 120,
      },
      reason: 'refresh_slot',
    }
  }

  if (
    [
      'reschedule_job',
      'update_job_address',
      'update_job_line_items',
      'add_job_note',
    ].includes(outcome.toolName) &&
    (error.includes('appointment not found') ||
      error.includes('appointment_id is required') ||
      error.includes('real uuid'))
  ) {
    return {
      lookupToolName: 'list_my_upcoming_appointments',
      lookupArgs: {},
      reason: 'refresh_appointment',
    }
  }

  return null
}

export function buildHarryTakeoverArgs(params: {
  failedOutcome: HarryToolOutcome
  recoveryPlan: HarryRecoveryPlan
  customerMessage: string
  state: HarryWorkflowState
}): Record<string, unknown> {
  const error = String(
    params.failedOutcome.error ||
      params.failedOutcome.result?.error ||
      'Automatic recovery did not complete the action.',
  )
  return {
    blocker_type:
      params.recoveryPlan.reason === 'refresh_appointment'
        ? 'cannot_match_appointment'
        : 'tool_error_after_retry',
    attempted_action: params.failedOutcome.toolName,
    customer_goal: params.customerMessage,
    known_details: JSON.stringify(params.state.collected_fields),
    blocking_reason: `Automatic ${params.recoveryPlan.reason} recovery failed.`,
    last_tool_error: error,
    retry_attempted: true,
    customer_waiting: true,
    customer_message_draft:
      "I couldn't safely complete that change, so I've alerted Charles to review it. I won't claim it's done until the system confirms it.",
  }
}
