// @vitest-environment node
/**
 * Integration test for the escalation safe-message delivery fix
 * (Michelle Tsirlis incident, 2026-06-12).
 *
 * On that morning Harry's reschedule failed, the automatic takeover alerted
 * Charles, but the customer's last SMS was "Let me try again... One moment!"
 * — the drafted safe message never went out. This test drives the REAL
 * generateAIResponse loop end-to-end: real Supabase DB, real tool executors,
 * real recovery + takeover path. Only the OpenAI HTTP responses are scripted
 * (via the project MSW server) so the failure is deterministic.
 *
 * Asserts:
 *  1. the turn returns the safe handoff message, not a retry promise
 *  2. the model is NOT given another round after the takeover
 *  3. the workflow state is escalated and the ledger holds the full
 *     primary -> recovery_lookup -> recovery_retry -> takeover chain
 *
 * Creates throwaway rows and removes every row it creates. The takeover's
 * Telegram/SMS sends no-op locally (credentials resolve to unconfigured) and
 * fall through without failing the tool.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { randomUUID } from 'node:crypto'

loadEnv({ path: '.env.local' })
process.env.AI_DISPATCHER_ENABLED = 'true'
process.env.HARRY_SMS_OPS_TOOLS = process.env.HARRY_SMS_OPS_TOOLS || 'true'
if (!process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = 'test-key'

import { createAdminClient } from '@/supabase/server'
import { server } from '@/mocks/server'
import { HARRY_TAKEOVER_SAFE_MESSAGE } from './recovery'

const TEST_PHONE = '+15005550041' // Twilio magic number, not routable

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

function toolCallCompletion(
  name: string,
  args: Record<string, unknown>,
  id: string,
) {
  return {
    id: `chatcmpl-${id}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4.1',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  }
}

function textCompletion(content: string) {
  return {
    id: 'chatcmpl-text',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'gpt-4.1',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content },
      },
    ],
  }
}

describe('Harry escalation safe-message delivery against the real DB', () => {
  const supabase = createAdminClient()
  const runId = randomUUID().slice(0, 8)
  const appointmentDate = futureDate(10)
  const rescheduleTarget = futureDate(11)

  let customerId = ''
  let addressId = ''
  let appointmentId = ''
  let conversationId = ''

  beforeAll(async () => {
    const { data: cust, error: cErr } = await supabase
      .from('ops_customers')
      .insert({
        full_name: 'Harry Escalation Test',
        first_name: 'Harry',
        last_name: 'Escalation Test',
        phone: TEST_PHONE,
        email: 'escalation-test@example.com',
      })
      .select('id')
      .single()
    if (cErr) throw cErr
    customerId = cust.id

    const { data: addr, error: aErr } = await supabase
      .from('ops_service_addresses')
      .insert({
        customer_id: customerId,
        street_1: '456 Escalation Way',
        city: 'Monument',
        state: 'CO',
        zip_code: '80132',
      })
      .select('id')
      .single()
    if (aErr) throw aErr
    addressId = addr.id

    const { data: appt, error: apErr } = await supabase
      .from('ops_appointments')
      .insert({
        customer_id: customerId,
        service_address_id: addressId,
        appointment_date: appointmentDate,
        start_time: '13:00:00',
        end_time: '15:00:00',
        status: 'booked',
      })
      .select('id')
      .single()
    if (apErr) throw apErr
    appointmentId = appt.id

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .insert({
        phone_number: TEST_PHONE,
        source: 'inbound',
        messages: [],
      })
      .select('id')
      .single()
    if (convErr) throw convErr
    conversationId = conv.id
  })

  afterAll(async () => {
    if (conversationId) {
      await supabase
        .from('harry_action_ledger')
        .delete()
        .eq('conversation_id', conversationId)
      await supabase
        .from('harry_workflow_states')
        .delete()
        .eq('conversation_id', conversationId)
      await supabase
        .from('ai_tool_calls')
        .delete()
        .eq('session_id', conversationId)
      await supabase.from('conversations').delete().eq('id', conversationId)
    }
    if (appointmentId) {
      await supabase
        .from('ops_appointment_status_events')
        .delete()
        .eq('appointment_id', appointmentId)
      await supabase.from('ops_appointments').delete().eq('id', appointmentId)
    }
    if (addressId) {
      await supabase.from('ops_service_addresses').delete().eq('id', addressId)
    }
    if (customerId) {
      await supabase.from('ops_customers').delete().eq('id', customerId)
    }
  })

  it('ends the turn with the safe handoff message after a takeover', async () => {
    let openaiCalls = 0
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        openaiCalls += 1
        if (openaiCalls === 1) {
          return HttpResponse.json(
            toolCallCompletion(
              'list_my_upcoming_appointments',
              {},
              `call_${runId}_list`,
            ),
          )
        }
        if (openaiCalls === 2) {
          // 23:30 is never an offered slot, so the reschedule fails, the
          // automatic refresh_slot recovery re-fails, and the takeover fires.
          return HttpResponse.json(
            toolCallCompletion(
              'reschedule_job',
              {
                appointment_ref: 'appointment_1',
                new_appointment_date: rescheduleTarget,
                new_start_time: '23:30',
                slot_ref: 'slot_1',
                // A stale/garbage token mirrors the production incident; it
                // gets the call past field validation so it fails on the
                // unavailable start time, which is a recoverable error class.
                slot_token: 'garbage.garbage',
              },
              `call_${runId}_resched`,
            ),
          )
        }
        // Pre-fix behavior: the model got another round and promised a retry.
        // If this text is ever returned to the customer again, the turn was
        // NOT ended deterministically and the test must fail.
        return HttpResponse.json(
          textCompletion(
            'Sorry, there was a system hiccup while rescheduling. Let me try again. One moment!',
          ),
        )
      }),
    )

    const { generateAIResponse } = await import('@/lib/openai-chat')

    const response = await generateAIResponse(
      'I need to reschedule my appointment to a later time please',
      [],
      undefined,
      'inbound',
      undefined,
      {
        customerPhoneE164: TEST_PHONE,
        sessionId: conversationId,
      },
    )

    // 1. The customer gets the safe handoff, not "One moment!"
    expect(response).toBe(HARRY_TAKEOVER_SAFE_MESSAGE)

    // 2. The model never got a round after the takeover.
    expect(openaiCalls).toBe(2)

    // 3. Workflow state is escalated with the takeover recorded.
    const { data: state } = await supabase
      .from('harry_workflow_states')
      .select('phase, takeover_status, takeover_reason')
      .eq('conversation_id', conversationId)
      .single()
    expect(state?.phase).toBe('escalated')
    expect(state?.takeover_status).toBe('requested')
    expect(state?.takeover_reason).toContain('recovery failed')

    // 4. The ledger holds the full failure -> recovery -> takeover chain.
    const { data: ledger } = await supabase
      .from('harry_action_ledger')
      .select('tool_name, attempt_kind, success')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    const kinds = (ledger || []).map(
      (row) => `${row.tool_name}:${row.attempt_kind}:${row.success}`,
    )
    expect(kinds).toContain('reschedule_job:primary:false')
    expect(kinds).toContain('get_calendar_slots:recovery_lookup:true')
    expect(kinds).toContain('reschedule_job:recovery_retry:false')
    expect(kinds).toContain('report_operational_problem:takeover:true')
  }, 60_000)

  it('hard-blocks mutation tools on the next turn while escalated', async () => {
    // The previous test left this conversation escalated (takeover requested,
    // taken_over_at = now). A follow-up customer demand to "just do it" must
    // NOT reach the reschedule executor.
    const { data: ledgerBefore } = await supabase
      .from('harry_action_ledger')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('tool_name', 'reschedule_job')
    const rescheduleRowsBefore = (ledgerBefore || []).length

    let openaiCalls = 0
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        openaiCalls += 1
        if (openaiCalls === 1) {
          return HttpResponse.json(
            toolCallCompletion(
              'reschedule_job',
              {
                appointment_ref: 'appointment_1',
                new_appointment_date: rescheduleTarget,
                new_start_time: '09:00',
                slot_token: 'garbage.garbage',
              },
              `call_${runId}_blocked`,
            ),
          )
        }
        return HttpResponse.json(
          textCompletion(
            'Charles is personally handling your reschedule and will follow up with you shortly.',
          ),
        )
      }),
    )

    const { generateAIResponse } = await import('@/lib/openai-chat')
    const response = await generateAIResponse(
      'Can you please just reschedule it now?',
      [],
      undefined,
      'inbound',
      undefined,
      {
        customerPhoneE164: TEST_PHONE,
        sessionId: conversationId,
      },
    )

    // The model saw the BLOCKED tool result and answered honestly.
    expect(response).toContain('Charles')
    expect(response).not.toContain('One moment')

    // The reschedule executor never ran: no new ledger rows for it.
    const { data: ledgerAfter } = await supabase
      .from('harry_action_ledger')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('tool_name', 'reschedule_job')
    expect((ledgerAfter || []).length).toBe(rescheduleRowsBefore)

    // The blocked attempt is still visible for forensics in ai_tool_calls.
    const { data: blockedCalls } = await supabase
      .from('ai_tool_calls')
      .select('error')
      .eq('session_id', conversationId)
      .eq('tool_name', 'reschedule_job')
      .ilike('error', 'BLOCKED%')
    expect((blockedCalls || []).length).toBeGreaterThan(0)
  }, 60_000)
})
