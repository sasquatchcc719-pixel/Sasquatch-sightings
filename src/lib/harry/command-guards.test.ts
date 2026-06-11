// @vitest-environment node
/**
 * Integration tests for the Harry Command (Telegram) recipient + blacklist
 * guards, exercised through the real executeToolCall against the real DB.
 *
 * These cover the June 2026 incident classes:
 * - artifact sends surfacing unrelated customers (Randy Shoemaker bleed)
 * - greeting/recipient mismatches ("Hi Marianne" → Alex's number)
 * - personalized greetings to unverified numbers ("Hi Roger" → Alex)
 * - blacklisted customers engaged without any flag
 *
 * They create a temporary command thread (and artifact) and remove every row
 * they create. No SMS is ever sent — executeToolCall only stages pending
 * approval actions.
 */
import { config as loadEnv } from 'dotenv'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

loadEnv({ path: '.env.local' })

import { createAdminClient } from '@/supabase/server'

type ExecuteToolCall =
  typeof import('@/app/api/telegram/harry-command/route').executeToolCall

const RANDY_PHONE = '+17196503305' // blacklisted ("difficult client")

describe('Harry Command guards against the real DB', () => {
  const supabase = createAdminClient()
  let executeToolCall: ExecuteToolCall
  let threadId = ''

  beforeAll(async () => {
    // Route module reads env at import time — import after dotenv runs.
    const route = await import('@/app/api/telegram/harry-command/route')
    executeToolCall = route.executeToolCall

    const { data, error } = await supabase
      .from('harry_command_threads')
      .insert({ telegram_chat_id: `test-${Date.now()}` })
      .select('id')
      .single()
    if (error) throw error
    threadId = data.id
  })

  afterAll(async () => {
    if (!threadId) return
    await supabase
      .from('harry_command_pending_actions')
      .delete()
      .eq('thread_id', threadId)
    await supabase
      .from('harry_command_action_audit')
      .delete()
      .eq('thread_id', threadId)
    await supabase
      .from('harry_command_artifacts')
      .delete()
      .eq('thread_id', threadId)
    await supabase.from('harry_command_threads').delete().eq('id', threadId)
  })

  it('send_sms to a blacklisted customer drafts but warns loudly', async () => {
    const result = await executeToolCall(
      'send_sms',
      {
        target: 'Randy Shoemaker',
        message: 'Hi Randy, quick note about your schedule.',
      },
      supabase,
      { threadId },
    )
    expect(result).toContain('SMS draft created')
    expect(result).toContain('BLACKLIST')
    expect(result).toContain('needs Charles approval')
  })

  it('send_sms blocks a greeting that does not match the recipient', async () => {
    const result = await executeToolCall(
      'send_sms',
      {
        target: 'Randy Shoemaker',
        message: 'Hi Marianne, your appointment is confirmed.',
      },
      supabase,
      { threadId },
    )
    expect(result).toContain('🛑')
    expect(result).toContain('did NOT draft')
  })

  it('send_sms refuses ambiguous first-name targets', async () => {
    const result = await executeToolCall(
      'send_sms',
      { target: 'Alex', message: 'Hi Alex, checking in.' },
      supabase,
      { threadId },
    )
    expect(result).toContain('matches')
    expect(result).toContain('customers')
  })

  it('send_sms blocks a personalized greeting to an unverified number', async () => {
    // Find a conversation with no linked customer record AND no ops_customers
    // phone match — the exact shape of the "Hi Roger" → Alex incident.
    const { data: candidates } = await supabase
      .from('conversations')
      .select('id, phone_number, ops_customer_id')
      .is('ops_customer_id', null)
      .limit(25)
    let unverified: { id: string; phone_number: string } | null = null
    for (const row of candidates || []) {
      const digits = String(row.phone_number || '').replace(/\D/g, '')
      if (digits.length < 10) continue
      const { data: match } = await supabase
        .from('ops_customers')
        .select('id')
        .ilike('phone', `%${digits.slice(-10)}%`)
        .limit(1)
        .maybeSingle()
      if (!match) {
        unverified = row as { id: string; phone_number: string }
        break
      }
    }
    if (!unverified) return // no such conversation right now — nothing to test

    await supabase
      .from('harry_command_threads')
      .update({
        metadata: {
          active_conversation_id: unverified.id,
          active_conversation_phone: unverified.phone_number,
        },
      })
      .eq('id', threadId)

    const result = await executeToolCall(
      'send_sms',
      {
        target: 'this customer',
        message: 'Hi Roger, could you confirm your address?',
      },
      supabase,
      { threadId },
    )
    expect(result).toContain('🛑')
    expect(result).toContain('did NOT draft')
  })

  it('lookup_customer flags blacklisted customers', async () => {
    const result = await executeToolCall(
      'lookup_customer',
      { customer_name: 'Randy Shoemaker' },
      supabase,
      { threadId },
    )
    expect(result).toContain('🚫 BLACKLISTED')
  })

  it('book_conversation_job hard-blocks blacklisted numbers', async () => {
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id')
      .eq('phone_number', RANDY_PHONE)
      .limit(1)
      .maybeSingle()
    const result = await executeToolCall(
      'book_conversation_job',
      {
        target: RANDY_PHONE,
        appointment_date: '2026-12-30',
        start_time: '09:00',
      },
      supabase,
      { threadId },
    )
    if (conversation) {
      expect(result).toContain('🛑 NOT booked')
      expect(result).toContain('BLACKLIST')
    } else {
      expect(result).toContain('❌')
    }
  })

  it('send_saved_report requires an explicit, unambiguous target', async () => {
    await supabase.from('harry_command_artifacts').insert({
      thread_id: threadId,
      artifact_type: 'customer_schedule_report',
      title: 'TEST schedule report (integration test)',
      content: 'Integration test artifact content. Do not send.',
    })

    const missingTarget = await executeToolCall(
      'send_saved_report',
      { target: '' },
      supabase,
      { threadId },
    )
    expect(missingTarget).toContain('❌')

    const ambiguous = await executeToolCall(
      'send_saved_report',
      { target: 'Alex' },
      supabase,
      { threadId },
    )
    expect(ambiguous).toContain('matches')

    const drafts: Array<{ id: string }> = []
    const blacklisted = await executeToolCall(
      'send_saved_report',
      { target: 'Randy Shoemaker' },
      supabase,
      {
        threadId,
        smsDrafts: drafts as never,
      },
    )
    expect(blacklisted).toContain('SMS draft created')
    expect(blacklisted).toContain('BLACKLIST')
    expect(drafts).toHaveLength(1)
  })
})
