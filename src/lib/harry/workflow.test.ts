import { describe, expect, it } from 'vitest'
import {
  formatHarryWorkflowContext,
  guardHarryResponseAgainstOutcomes,
  responseClaimsCompletedAction,
  type HarryWorkflowState,
} from './workflow'

function workflowState(
  overrides: Partial<HarryWorkflowState> = {},
): HarryWorkflowState {
  return {
    conversation_id: 'conversation-1',
    intent: 'reschedule',
    phase: 'action_failed',
    last_customer_message: '11-1 would work',
    last_assistant_message: null,
    last_action_name: 'reschedule_job',
    last_action_status: 'failed',
    last_action_error: 'slot_token does not match the selected slot',
    action_context: {
      args: {
        new_appointment_date: '2026-06-08',
        new_start_time: '11:00',
      },
    },
    turn_count: 4,
    last_customer_at: '2026-06-07T12:00:00.000Z',
    last_assistant_at: null,
    ...overrides,
  }
}

describe('Harry workflow truth guard', () => {
  it('recognizes customer-facing action completion claims', () => {
    expect(responseClaimsCompletedAction("You're all set for Monday.")).toBe(
      true,
    )
    expect(responseClaimsCompletedAction("I've saved the garage code.")).toBe(
      true,
    )
    expect(responseClaimsCompletedAction('Which time works best?')).toBe(false)
  })

  it('blocks a false confirmation after a failed action, even on a later turn', () => {
    const guarded = guardHarryResponseAgainstOutcomes({
      response: "Thanks! You're all set for Monday at 11:00 AM.",
      workflowState: workflowState(),
      outcomes: [],
    })

    expect(guarded.blockedFalseClaim).toBe(true)
    expect(guarded.response).toContain("I couldn't complete that change yet")
    expect(guarded.response).toContain(
      'The selected appointment time could not be verified.',
    )
    expect(guarded.response).not.toContain("You're all set")
  })

  it('allows a confirmation after the current tool call succeeds', () => {
    const response = "You're all set for Monday at 11:00 AM."
    const guarded = guardHarryResponseAgainstOutcomes({
      response,
      workflowState: workflowState({ phase: 'gathering' }),
      outcomes: [
        {
          toolCallId: 'call-1',
          toolName: 'reschedule_job',
          args: {},
          result: { success: true },
          success: true,
          error: null,
        },
      ],
    })

    expect(guarded).toEqual({
      response,
      blockedFalseClaim: false,
    })
  })

  it('uses the latest mutation outcome when several actions run in one turn', () => {
    const guarded = guardHarryResponseAgainstOutcomes({
      response: "You're all set.",
      workflowState: workflowState(),
      outcomes: [
        {
          toolCallId: 'call-1',
          toolName: 'update_job_address',
          args: {},
          result: { success: true },
          success: true,
          error: null,
        },
        {
          toolCallId: 'call-2',
          toolName: 'reschedule_job',
          args: {},
          result: { error: 'appointment not found' },
          success: false,
          error: 'appointment not found',
        },
      ],
    })

    expect(guarded.blockedFalseClaim).toBe(true)
    expect(guarded.response).toContain(
      "I couldn't match the appointment to this phone number.",
    )
  })

  it('allows later confirmation of a durable verified success', () => {
    const response = 'Yes, your appointment has been rescheduled.'
    const guarded = guardHarryResponseAgainstOutcomes({
      response,
      workflowState: workflowState({
        phase: 'completed',
        last_action_status: 'succeeded',
        last_action_error: null,
      }),
      outcomes: [],
    })

    expect(guarded.blockedFalseClaim).toBe(false)
    expect(guarded.response).toBe(response)
  })

  it('allows an existing-appointment lookup to say the customer is all set', () => {
    const response = "You're all set for Monday at 11:00 AM."
    const guarded = guardHarryResponseAgainstOutcomes({
      response,
      workflowState: workflowState({
        intent: 'appointment_lookup',
        phase: 'gathering',
        last_action_name: null,
        last_action_status: null,
        last_action_error: null,
      }),
      outcomes: [],
    })

    expect(guarded).toEqual({
      response,
      blockedFalseClaim: false,
    })
  })

  it('injects verified failure state and selected details into future turns', () => {
    const context = formatHarryWorkflowContext(workflowState())

    expect(context).toContain('Intent: reschedule')
    expect(context).toContain('Phase: action_failed')
    expect(context).toContain('new_appointment_date')
    expect(context).toContain('2026-06-08')
    expect(context).toContain('do not claim the action succeeded')
  })
})
