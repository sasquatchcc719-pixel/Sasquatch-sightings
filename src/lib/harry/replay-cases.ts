import type { HarryToolOutcome, HarryWorkflowState } from './workflow'

export type HarryReplayCase = {
  name: string
  state: HarryWorkflowState
  outcome: HarryToolOutcome
  proposedResponse: string
  expectedRecovery: 'refresh_slot' | 'refresh_appointment' | 'none'
  expectFalseClaimBlocked: boolean
}

function replayState(
  overrides: Partial<HarryWorkflowState> = {},
): HarryWorkflowState {
  return {
    conversation_id: '00000000-0000-0000-0000-000000000001',
    intent: 'reschedule',
    phase: 'action_failed',
    last_customer_message: '11 would work',
    last_assistant_message: null,
    last_action_name: 'reschedule_job',
    last_action_status: 'failed',
    last_action_error: 'slot_token does not match the selected slot',
    action_context: {},
    collected_fields: {
      requested_date: '2026-06-08',
      selected_start_time: '11:00',
      duration_minutes: 120,
    },
    missing_fields: [],
    server_refs: {},
    consecutive_failures: 1,
    recovery_attempts: 0,
    takeover_status: 'none',
    takeover_reason: null,
    taken_over_at: null,
    turn_count: 4,
    last_customer_at: '2026-06-07T18:00:00.000Z',
    last_assistant_at: null,
    ...overrides,
  }
}

export const HARRY_PRODUCTION_REPLAY_CASES: HarryReplayCase[] = [
  {
    name: 'stale signed slot after a delayed customer reply',
    state: replayState(),
    outcome: {
      toolCallId: 'replay-slot',
      toolName: 'reschedule_job',
      args: {
        new_appointment_date: '2026-06-08',
        new_start_time: '11:00',
      },
      result: { error: 'slot_token does not match the selected slot' },
      success: false,
      error: 'slot_token does not match the selected slot',
    },
    proposedResponse: "You're all set for Monday at 11.",
    expectedRecovery: 'refresh_slot',
    expectFalseClaimBlocked: true,
  },
  {
    name: 'stale appointment match during a job update',
    state: replayState({ intent: 'update_address' }),
    outcome: {
      toolCallId: 'replay-appointment',
      toolName: 'update_job_address',
      args: { appointment_id: 'stale-id' },
      result: { error: 'appointment not found for this phone number' },
      success: false,
      error: 'appointment not found for this phone number',
    },
    proposedResponse: "I've updated the address.",
    expectedRecovery: 'refresh_appointment',
    expectFalseClaimBlocked: true,
  },
  {
    name: 'job note attempted before appointment lookup',
    state: replayState({ intent: 'add_job_note' }),
    outcome: {
      toolCallId: 'replay-job-note',
      toolName: 'add_job_note',
      args: { note: 'The key is in the brown barrel out front.' },
      result: { error: 'appointment_id and note are required' },
      success: false,
      error: 'appointment_id and note are required',
    },
    proposedResponse: "I'll make sure Charles knows where the key is.",
    expectedRecovery: 'refresh_appointment',
    expectFalseClaimBlocked: false,
  },
  {
    name: 'ordinary missing booking details do not trigger tool retries',
    state: replayState({
      intent: 'new_booking',
      phase: 'awaiting_contact',
      last_action_name: null,
      last_action_status: null,
      last_action_error: null,
      collected_fields: { requested_date: '2026-06-08' },
      missing_fields: ['email'],
      consecutive_failures: 0,
    }),
    outcome: {
      toolCallId: 'replay-missing-info',
      toolName: 'book_new_job',
      args: {},
      result: { error: 'email is required' },
      success: false,
      error: 'email is required',
    },
    proposedResponse: 'What email should I use?',
    expectedRecovery: 'none',
    expectFalseClaimBlocked: false,
  },
  {
    name: 'verified recovery retry permits a confirmation',
    state: replayState({
      phase: 'completed',
      last_action_status: 'succeeded',
      last_action_error: null,
      consecutive_failures: 0,
      recovery_attempts: 1,
    }),
    outcome: {
      toolCallId: 'replay-retry-success',
      toolName: 'reschedule_job',
      args: {},
      result: { success: true },
      success: true,
      error: null,
      attemptKind: 'recovery_retry',
    },
    proposedResponse: "You're all set for Monday at 11.",
    expectedRecovery: 'none',
    expectFalseClaimBlocked: false,
  },
]
