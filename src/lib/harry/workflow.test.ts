import { describe, expect, it } from 'vitest'
import {
  advanceHarryWorkflowState,
  formatHarryWorkflowContext,
  guardHarryResponseAgainstOutcomes,
  prepareHarryToolArgs,
  requiredHarryToolForState,
  responseClaimsCompletedAction,
  sanitizeHarryToolResultForModel,
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
    collected_fields: {
      requested_date: '2026-06-08',
      selected_start_time: '11:00',
    },
    missing_fields: [],
    server_refs: {},
    consecutive_failures: 1,
    recovery_attempts: 0,
    takeover_status: 'none',
    takeover_reason: null,
    taken_over_at: null,
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
    expect(guarded.response).toContain("I couldn't complete that change")
    expect(guarded.response).toContain(
      'The selected appointment time could not be verified.',
    )
    expect(guarded.response).not.toContain("You're all set")
    expect(guarded.response).not.toContain("I've alerted Charles")
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

  it('only claims a human alert after takeover delivery is verified', () => {
    const blocked = guardHarryResponseAgainstOutcomes({
      response: "I'm flagging this for Charles now.",
      workflowState: workflowState(),
      outcomes: [],
    })
    const allowed = guardHarryResponseAgainstOutcomes({
      response: "I've alerted Charles to review this.",
      workflowState: workflowState({
        phase: 'escalated',
        takeover_status: 'requested',
      }),
      outcomes: [],
    })

    expect(blocked.blockedFalseClaim).toBe(true)
    expect(blocked.response).toContain("couldn't complete")
    expect(allowed.blockedFalseClaim).toBe(false)
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
    expect(context).toContain('requested_date')
    expect(context).toContain('2026-06-08')
    expect(context).toContain('do not claim the action succeeded')
  })

  it('resumes a delayed reply by selecting the matching offered slot', () => {
    const next = advanceHarryWorkflowState(
      workflowState({
        phase: 'awaiting_slot',
        last_action_status: null,
        last_action_error: null,
        collected_fields: { requested_date: '2026-06-08' },
        server_refs: {
          appointments: [
            {
              ref: 'appointment_1',
              appointment_id: 'appointment-secret',
            },
          ],
          selected_appointment_ref: 'appointment_1',
          slots: [
            {
              ref: 'slot_1',
              slot_token: 'signed-secret',
              date: '2026-06-08',
              start_time: '11:00',
            },
          ],
        },
      }),
      '11 would work',
    )

    expect(next.phase).toBe('ready_to_execute')
    expect(next.server_refs.selected_slot_ref).toBe('slot_1')
    expect(next.collected_fields.selected_start_time).toBe('11:00')
  })

  it('treats a hidden key location as a job note that must be persisted', () => {
    const next = advanceHarryWorkflowState(
      workflowState({
        intent: 'appointment_lookup',
        phase: 'gathering',
        last_action_name: null,
        last_action_status: null,
        last_action_error: null,
        server_refs: {},
      }),
      'Thank you. The key is in the brown pot.',
    )

    expect(next.intent).toBe('add_job_note')
    expect(next.phase).toBe('awaiting_appointment')
    expect(next.missing_fields).toEqual(['appointment'])
    expect(requiredHarryToolForState(next)).toBe(
      'list_my_upcoming_appointments',
    )
  })

  it('requires the note mutation after the appointment lookup succeeds', () => {
    const state = workflowState({
      intent: 'add_job_note',
      phase: 'ready_to_execute',
      last_action_name: 'list_my_upcoming_appointments',
      last_action_status: null,
      last_action_error: null,
      server_refs: {
        appointments: [
          {
            ref: 'appointment_1',
            appointment_id: 'appointment-secret',
          },
        ],
        selected_appointment_ref: 'appointment_1',
      },
    })

    expect(requiredHarryToolForState(state)).toBe('add_job_note')
    expect(
      prepareHarryToolArgs({
        toolName: 'add_job_note',
        args: { note: 'The key is in the brown pot.' },
        workflowState: state,
      }),
    ).toEqual({
      appointment_id: 'appointment-secret',
      note: 'The key is in the brown pot.',
    })
  })

  it('does not loop appointment lookup when several jobs need clarification', () => {
    const state = workflowState({
      intent: 'add_job_note',
      phase: 'awaiting_appointment',
      last_action_name: 'list_my_upcoming_appointments',
      last_action_status: null,
      last_action_error: null,
      server_refs: {
        appointments: [
          {
            ref: 'appointment_1',
            appointment_id: 'appointment-one',
          },
          {
            ref: 'appointment_2',
            appointment_id: 'appointment-two',
          },
        ],
      },
    })

    expect(requiredHarryToolForState(state)).toBeNull()
  })

  it('hydrates server-owned references immediately before execution', () => {
    const args = prepareHarryToolArgs({
      toolName: 'reschedule_job',
      args: {
        appointment_ref: 'appointment_1',
        slot_ref: 'slot_1',
      },
      workflowState: workflowState({
        server_refs: {
          appointments: [
            {
              ref: 'appointment_1',
              appointment_id: 'appointment-secret',
            },
          ],
          slots: [
            {
              ref: 'slot_1',
              slot_token: 'signed-secret',
              date: '2026-06-08',
              start_time: '11:00',
            },
          ],
        },
      }),
    })

    expect(args).toMatchObject({
      appointment_id: 'appointment-secret',
      slot_token: 'signed-secret',
      new_appointment_date: '2026-06-08',
      new_start_time: '11:00',
    })
    expect(args).not.toHaveProperty('appointment_ref')
    expect(args).not.toHaveProperty('slot_ref')
  })

  it('redacts raw server identifiers from model-visible results and context', () => {
    const sanitized = sanitizeHarryToolResultForModel({
      toolName: 'get_calendar_slots',
      result: {
        slots: [
          {
            start_time: '11:00',
            slot_token: 'signed-secret',
            assigned_staff_user_id: 'staff-secret',
          },
        ],
      },
    })
    const context = formatHarryWorkflowContext(
      workflowState({
        server_refs: {
          services: [
            {
              ref: 'service_1',
              service_id: 'service-secret',
              name: 'Carpet cleaning',
            },
          ],
        },
        collected_fields: {
          line_items: [{ service_id: 'service-secret', quantity: 1 }],
        },
      }),
    )

    expect(sanitized).toEqual({
      slots: [{ slot_ref: 'slot_1', start_time: '11:00' }],
    })
    expect(context).toContain('"service_ref":"service_1"')
    expect(context).not.toContain('service-secret')
  })
})
