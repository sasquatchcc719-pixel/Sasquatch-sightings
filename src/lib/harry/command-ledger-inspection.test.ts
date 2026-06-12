// @vitest-environment node
/**
 * Integration tests for the Harry Command inspect_harry_actions tool,
 * exercised through the real executeToolCall against the real DB.
 *
 * Pinned to the June 12, 2026 reschedule incident: Harry's reschedule_job
 * failed three times with a slot_token mismatch for conversation
 * a8a6a8c6-78b0-4b4b-8132-ff20db24cf14, but the owner bot explained the
 * failure from generic priors ("customer was ambiguous") instead of reading
 * the ledger. The tool must surface the recorded error verbatim.
 *
 * Read-only — these tests query historical ledger rows and create nothing.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

type ExecuteToolCall =
  typeof import('@/app/api/telegram/harry-command/route').executeToolCall

const INCIDENT_CONVERSATION_ID = 'a8a6a8c6-78b0-4b4b-8132-ff20db24cf14'
const INCIDENT_PHONE = '+12524221396'
const RECORDED_ERROR = 'slot_token does not match the selected appointment slot'

describe('inspect_harry_actions against the real DB', () => {
  const supabase = createAdminClient()
  let executeToolCall: ExecuteToolCall

  beforeAll(async () => {
    // Route module reads env at import time — import after dotenv runs.
    const route = await import('@/app/api/telegram/harry-command/route')
    executeToolCall = route.executeToolCall
  })

  it('returns the recorded reschedule error verbatim by conversation ID', async () => {
    const result = await executeToolCall(
      'inspect_harry_actions',
      { target: INCIDENT_CONVERSATION_ID },
      supabase,
      {},
    )
    expect(result).toContain(`Conversation ${INCIDENT_CONVERSATION_ID}`)
    expect(result).toContain(INCIDENT_PHONE)
    expect(result).toContain('❌ FAILED reschedule_job')
    expect(result).toContain(RECORDED_ERROR)
    // The recovery retry attempt must be visible, not just the primary failure.
    expect(result).toContain('[recovery_retry]')
  })

  it('resolves the same ledger by customer phone number', async () => {
    const result = await executeToolCall(
      'inspect_harry_actions',
      { target: INCIDENT_PHONE },
      supabase,
      {},
    )
    expect(result).toContain(INCIDENT_PHONE)
    expect(result).toContain(RECORDED_ERROR)
  })

  it('only_failures hides successful attempts', async () => {
    const result = await executeToolCall(
      'inspect_harry_actions',
      { target: INCIDENT_CONVERSATION_ID, only_failures: true },
      supabase,
      {},
    )
    expect(result).toContain('❌ FAILED reschedule_job')
    expect(result).toContain(RECORDED_ERROR)
    // get_calendar_slots succeeded during the incident; with only_failures it
    // must not appear as a ledger entry line (the error text may mention it).
    expect(result).not.toContain('✅ get_calendar_slots')
    expect(result).not.toContain('✅ report_operational_problem')
  })

  it('says plainly when no conversation matches instead of guessing', async () => {
    const result = await executeToolCall(
      'inspect_harry_actions',
      { target: '00000000-0000-4000-8000-000000000000' },
      supabase,
      {},
    )
    expect(result).toContain("❌ Couldn't find a conversation")
  })
})
