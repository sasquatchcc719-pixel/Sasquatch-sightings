/**
 * Telegram Harry Command Bot — Tools Integration Test
 *
 * Executes every Telegram bot tool against the real Supabase database to
 * confirm none of them crash with broken column refs / missing tables / etc.
 * Read-only tools run for real; mutation tools run with invalid inputs to
 * verify they reach validation instead of throwing on import or a DB error.
 *
 * Usage: cd "Sasquatch Sightings" && pnpm tsx -r tsconfig-paths/register -r dotenv/config scripts/test-telegram-tools-integration.ts dotenv_config_path=.env.local
 */

import { createAdminClient } from '@/supabase/server'
import { executeToolCall } from '@/app/api/telegram/harry-command/route'

type ToolTest = {
  name: string
  args: Record<string, unknown>
  // Acceptable: any non-throwing string response. Crash signatures we WANT to flag:
  crashSignatures?: string[]
}

const tests: ToolTest[] = [
  {
    name: 'list_recent_conversations',
    args: {},
  },
  {
    name: 'view_conversation',
    args: { target: '+19105805500' },
  },
  {
    name: 'search_conversation_history',
    args: { target: 'Clarissa', limit: 3 },
  },
  {
    name: 'lookup_customer',
    args: { customer_name: 'Charles Sewell' },
  },
  {
    name: 'customer_history',
    args: { customer_name: 'Charles Sewell', limit: 3 },
  },
  {
    name: 'customer_schedule_summary',
    args: { customer_name: 'Charles Sewell' },
  },
  {
    name: 'search_job_details',
    args: { query: 'carpet', limit: 3 },
  },
  {
    name: 'view_schedule',
    args: { date: 'today' },
  },
  {
    name: 'check_availability',
    args: { date: '2026-05-20', start_time: '09:00', duration_hours: 2 },
  },
  {
    name: 'today_summary',
    args: {},
  },
  {
    name: 'send_sms',
    args: { target: 'Charles Sewell', message: 'Test draft — do not send' },
  },
  {
    name: 'take_over_conversation',
    args: { target: '+15555550000' },
  },
  {
    name: 'enable_harry',
    args: { target: '+15555550000' },
  },
  {
    name: 'add_appointment',
    args: {
      customer_name: 'Charles Sewell',
      date: '2026-05-20',
      time: '09:00',
      note: 'Integration test — not real',
    },
  },
  {
    name: 'book_conversation_job',
    args: {
      target: '+19999999999',
      appointment_date: '2026-05-20',
      start_time: '09:00',
    },
  },
  {
    name: 'update_appointment',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
      new_date: '2026-05-20',
    },
  },
  {
    name: 'cancel_appointment',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
    },
  },
  {
    name: 'mark_complete',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
    },
  },
  {
    name: 'add_customer',
    args: {
      full_name: 'IntegrationTest DoNotInsert',
      email: 'test-integration-only@example.invalid',
      phone: '+19999999999',
    },
  },
  {
    name: 'payment_status',
    args: { customer_name: 'Charles Sewell' },
  },
  {
    name: 'add_job_note',
    args: { customer_name: 'Charles Sewell', note: 'integration-test note' },
  },
]

const CRASH_SIGNATURES = [
  'does not exist',
  'column ',
  'relation ',
  'ReferenceError',
  'TypeError',
  'Cannot read prop',
  'undefined is not',
  'syntax error',
]

async function run() {
  const supabase = createAdminClient()
  console.log('='.repeat(80))
  console.log('  TELEGRAM HARRY TOOLS — INTEGRATION TEST')
  console.log('='.repeat(80))
  console.log()

  let passed = 0
  let failed = 0
  const failures: { name: string; reason: string }[] = []

  for (const test of tests) {
    process.stdout.write(`  ${test.name.padEnd(34)} ... `)
    try {
      const result = await executeToolCall(test.name, test.args, supabase, {
        threadId: 'c0057fe8-0cca-42f1-a80e-65519e154fe4',
      })
      const lower = String(result).toLowerCase()
      const sig = CRASH_SIGNATURES.find((s) => lower.includes(s.toLowerCase()))
      if (sig) {
        console.log(`❌ CRASH SIGNATURE: "${sig}"`)
        failures.push({
          name: test.name,
          reason: `crash signature "${sig}" — ${String(result).slice(0, 200)}`,
        })
        failed++
      } else {
        const snippet = String(result).replace(/\s+/g, ' ').slice(0, 70)
        console.log(`✅ ${snippet}${result.length > 70 ? '…' : ''}`)
        passed++
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`❌ THREW: ${msg.slice(0, 80)}`)
      failures.push({ name: test.name, reason: `threw ${msg}` })
      failed++
    }
  }

  console.log()
  console.log('='.repeat(80))
  console.log(`  RESULTS: ${passed}/${tests.length} passed, ${failed} failures`)
  if (failures.length > 0) {
    console.log()
    console.log('  Failures:')
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.reason}`)
    }
  }
  console.log('='.repeat(80))
  process.exit(failed > 0 ? 1 : 0)
}

run()
