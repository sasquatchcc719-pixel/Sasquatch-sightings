/**
 * Harry SMS Tools Integration Test
 *
 * Executes every Harry SMS tool against the real Supabase database to verify
 * they actually run without errors. Read-only tools run for real; write tools
 * (book_new_job, reschedule_job, update_*) run with intentionally invalid args
 * to confirm they reach the validation layer instead of throwing on import or
 * a broken column reference.
 *
 * Usage: cd "Sasquatch Sightings" && pnpm tsx -r tsconfig-paths/register -r dotenv/config scripts/test-harry-tools-integration.ts dotenv_config_path=.env.local
 */

import { createAdminClient } from '@/supabase/server'
import { executeHarrySmsTool } from '@/lib/ops/sms-harry-tools'

type ToolTest = {
  name: string
  args: Record<string, unknown>
  expectError?: boolean
  expectKey?: string
}

const TEST_PHONE = '+19105805500' // Clarissa Romero — known existing customer

const tests: ToolTest[] = [
  { name: 'get_my_customer_profile', args: {}, expectKey: 'matched' },
  {
    name: 'list_my_upcoming_appointments',
    args: {},
    expectKey: 'phone_number_seen',
  },
  {
    name: 'search_service_catalog',
    args: { query: 'Regular Size Room' },
    expectKey: 'services',
  },
  {
    name: 'get_calendar_slots',
    args: { date: '2026-05-20', duration_minutes: 60 },
    expectKey: 'slots',
  },
  {
    name: 'update_job_address',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
      street_1: '123 Test',
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
    },
    expectError: true,
  },
  {
    name: 'reschedule_job',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
      new_date: '2026-05-20',
      new_start_time: '09:00',
      slot_token: 'invalid_token',
    },
    expectError: true,
  },
  {
    name: 'update_job_line_items',
    args: {
      appointment_id: '00000000-0000-0000-0000-000000000000',
      line_items: [],
    },
    expectError: true,
  },
  {
    name: 'book_new_job',
    args: {
      customer_first_name: 'Test',
      customer_last_name: 'Test',
      customer_email: 'test@test.com',
      service_street_1: '123 Test St',
      service_city: 'Monument',
      service_state: 'CO',
      service_zip_code: '80132',
      appointment_date: '2026-05-20',
      start_time: '09:00',
      slot_token: 'invalid_token',
      lead_source: 'Other',
      line_items: [{ service_id: 'invalid', quantity: 1 }],
    },
    expectError: true,
  },
  {
    name: 'book_commercial_estimate',
    args: {
      customer_first_name: 'Test',
      customer_last_name: 'Business',
      customer_email: 'test@test.com',
      customer_phone: '+17195551234',
      property_street_1: '123 Business Way',
      property_city: 'Monument',
      property_state: 'CO',
      property_zip_code: '80132',
      appointment_date: '2026-05-20',
      start_time: '09:00',
      slot_token: 'invalid_token',
      property_description: 'Test office',
      lead_source: 'Other',
    },
    expectError: true,
  },
  {
    name: 'report_operational_problem',
    args: {
      blocker_type: 'invalid_type',
      attempted_action: 'test',
      customer_goal: 'test',
      known_details: 'test',
      blocking_reason: 'test',
      retry_attempted: true,
      customer_waiting: false,
      customer_message_draft: 'Test draft',
    },
    expectError: true,
  },
]

async function run() {
  const supabase = createAdminClient()
  console.log('='.repeat(80))
  console.log(`  HARRY SMS TOOLS — INTEGRATION TEST (phone: ${TEST_PHONE})`)
  console.log('='.repeat(80))
  console.log()

  let passed = 0
  let failed = 0
  const failures: string[] = []

  for (const test of tests) {
    const ctx = {
      supabase,
      customerPhoneE164: TEST_PHONE,
      isLsaRelay: false,
    }
    process.stdout.write(`  ${test.name.padEnd(36)} ... `)
    try {
      const rawResult = await executeHarrySmsTool(
        test.name,
        JSON.stringify(test.args),
        ctx,
      )
      const result = JSON.parse(rawResult)
      const hasGenericError =
        result.error === 'Action failed. The office can help at (719) 249-8791.'

      if (hasGenericError) {
        console.log('❌ CRASHED (generic error)')
        failures.push(`${test.name}: hit generic catch-all error`)
        failed++
        continue
      }

      if (test.expectError) {
        if (result.error) {
          console.log(
            `✅ OK (validation error: ${String(result.error).slice(0, 60)})`,
          )
          passed++
        } else if (result.success === false) {
          console.log(`✅ OK (handled failure)`)
          passed++
        } else {
          console.log(`⚠️  UNEXPECTED: expected error, got success`)
          failures.push(`${test.name}: expected error but succeeded`)
          failed++
        }
        continue
      }

      if (test.expectKey && !(test.expectKey in result)) {
        console.log(`❌ MISSING KEY "${test.expectKey}"`)
        failures.push(
          `${test.name}: missing expected key "${test.expectKey}" in result`,
        )
        failed++
        continue
      }

      console.log('✅ OK')
      passed++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`❌ THREW: ${msg.slice(0, 80)}`)
      failures.push(`${test.name}: threw ${msg}`)
      failed++
    }
  }

  console.log()
  console.log('='.repeat(80))
  console.log(`  RESULTS: ${passed}/${tests.length} passed, ${failed} failures`)
  if (failures.length > 0) {
    console.log()
    console.log('  Failures:')
    for (const f of failures) console.log(`  - ${f}`)
  }
  console.log('='.repeat(80))

  process.exit(failed > 0 ? 1 : 0)
}

run()
