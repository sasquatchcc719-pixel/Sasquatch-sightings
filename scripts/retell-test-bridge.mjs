#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const API_BASE = 'https://api.retellai.com'
const DEFAULT_FLOW_ID = 'conversation_flow_870fe1ad2384'

async function loadDotEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
      if (!match) continue
      const [, key, value] = match
      if (process.env[key] !== undefined) continue
      process.env[key] = value
        .replace(/^['"]|['"]$/g, '')
        .replace(/\\n$/g, '')
        .trim()
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
}

async function loadEnv() {
  await loadDotEnvFile('.env.local')
  await loadDotEnvFile('.env')
}

function parseArgs(argv) {
  const args = {
    command: argv[2] || 'help',
    flowId: DEFAULT_FLOW_ID,
    flowVersion: 0,
    limit: 50,
    testCaseIds: [],
    batchId: '',
    runId: '',
    name: 'Rabecca deterministic booking smoke test',
  }

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--flow-id') {
      args.flowId = argv[i + 1] || args.flowId
      i += 1
    } else if (arg === '--flow-version') {
      args.flowVersion = Number(argv[i + 1] || args.flowVersion)
      i += 1
    } else if (arg === '--limit') {
      args.limit = Number(argv[i + 1] || args.limit)
      i += 1
    } else if (arg === '--test-case-id') {
      args.testCaseIds.push(argv[i + 1])
      i += 1
    } else if (arg === '--batch-id') {
      args.batchId = argv[i + 1] || ''
      i += 1
    } else if (arg === '--run-id') {
      args.runId = argv[i + 1] || ''
      i += 1
    } else if (arg === '--name') {
      args.name = argv[i + 1] || args.name
      i += 1
    }
  }

  args.testCaseIds = args.testCaseIds.filter(Boolean)
  return args
}

async function retellRequest(pathname, options = {}) {
  const key = process.env.RETELL_API_KEY
  if (!key) throw new Error('RETELL_API_KEY is missing.')

  const response = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }

  if (!response.ok) {
    throw new Error(
      `Retell API ${pathname} failed with ${response.status}: ${JSON.stringify(
        body,
      )}`,
    )
  }

  return body
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    )
  }
  return createClient(url, key)
}

function timestampValue(value) {
  if (!value) return null
  const milliseconds = Number(value) > 10_000_000_000 ? Number(value) : Number(value) * 1000
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function transcriptToText(snapshot) {
  if (!snapshot) return ''
  if (typeof snapshot === 'string') return snapshot
  if (Array.isArray(snapshot)) {
    return snapshot
      .map((item) => {
        if (typeof item === 'string') return item
        const role = item.role || item.speaker || item.type || 'Message'
        const content = item.content || item.text || item.message || ''
        return `${role}: ${content}`
      })
      .join('\n')
  }

  const messages =
    snapshot.messages ||
    snapshot.transcript ||
    snapshot.conversation ||
    snapshot.turns ||
    []

  if (Array.isArray(messages)) return transcriptToText(messages)
  return JSON.stringify(snapshot, null, 2)
}

async function listTestCaseDefinitions(args) {
  const url = new URL(`${API_BASE}/v2/list-test-case-definitions`)
  url.searchParams.set('type', 'conversation-flow')
  url.searchParams.set('conversation_flow_id', args.flowId)
  url.searchParams.set('limit', String(args.limit))

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`Retell list-test-case-definitions failed: ${JSON.stringify(body)}`)
  }

  const items = body.items || []
  console.log(`Found ${items.length} test case definition(s).`)
  for (const item of items) {
    console.log(
      `${item.test_case_definition_id} | ${item.name || 'Untitled'} | ${item.type}`,
    )
  }
}

async function createBatchTest(args) {
  const testCaseIds = args.testCaseIds
  if (testCaseIds.length === 0) {
    throw new Error('Pass at least one --test-case-id.')
  }

  const batch = await retellRequest('/create-batch-test', {
    method: 'POST',
    body: {
      test_case_definition_ids: testCaseIds,
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
    },
  })

  console.log(JSON.stringify(batch, null, 2))
}

async function createSmokeTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Rick James.
You are testing a carpet cleaning booking assistant.

## Goal
Book four regular bedrooms of carpet cleaning for Monday, May 4, 2026 at 2:00 PM.
Provide your contact details when asked:
- phone: 719-749-8807
- email: clsewell970@gmail.com
- address: 740 Platt Lane, Palmer Lake, Colorado 80133

## Personality
You are direct and mildly impatient. If the assistant repeats the same question after you answered it, point that out. Do not invent extra services. End only after the assistant clearly confirms the booking.`,
      metrics: [
        'The agent quotes $184 for four regular bedrooms.',
        'The agent offers only real returned appointment windows.',
        'The agent calls book_prepared_slot before saying the appointment is booked.',
        'The agent does not repeatedly ask for details already provided.',
        'The agent confirms the booking after the booking tool succeeds.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $184.',
            data: {
              quote_total: 184,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              appointment_date: '2026-05-04',
              line_items: [
                {
                  service_id: 'a6994150-dfb5-4bf9-822b-40b0511a0539',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 4,
                  unit_price: 46,
                  total: 184,
                },
              ],
              missing_fields: [],
              slots: [
                { start_time: '14:00:00', end_time: '16:00:00' },
                { start_time: '15:00:00', end_time: '17:00:00' },
              ],
              caller_script:
                'The estimate is $184. I found 2 PM to 4 PM and 3 PM to 5 PM. Which one works best?',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message:
              'Booking confirmed! Confirmation number: TEST-SC-123. The customer will receive a confirmation text and email.',
            data: {
              appointment_id: 'test-appointment-id',
              confirmation_number: 'TEST-SC-123',
              appointment_status: 'booked',
              appointment_date: '2026-05-04',
              start_time: '14:00',
              end_time: '16:00',
              total: 184,
              caller_script:
                "You're all set for Monday, May 4 at 2:00 PM. You'll receive confirmation with the details.",
            },
          }),
        },
      ],
      dynamic_variables: {},
    },
  })

  console.log(JSON.stringify(definition, null, 2))
  return definition
}

async function createMinimumAddOnLoopTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Mike.
You are testing a carpet cleaning booking assistant.

## Goal
You want carpet cleaning for two regular bedrooms. Ask for the earliest available date.
When the assistant says the two-bedroom quote is below the minimum, add one hallway and again ask for the updated total and earliest available date.

## Behavior
If the updated total is still below minimum, do not add more services. Ask what exactly is needed next. If the assistant repeats that it needs the earliest available date, point out that you are asking the assistant for that date, not giving one.`,
      metrics: [
        'The agent quotes $92 for two regular bedrooms.',
        'After the hallway is added, the agent quotes $117.',
        'The agent says the updated job is still below the $150 minimum and $33 short.',
        'The agent does not ask the caller to provide the earliest available date.',
        'The agent does not offer appointment slots or claim a booking while the job is below minimum.',
        'The agent gives a clear next step instead of looping.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'partial_match', args: { hall_count: 1 } },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $117.',
            data: {
              quote_total: 117,
              minimum_booking_amount: 150,
              amount_needed_to_minimum: 33,
              meets_minimum: false,
              can_offer_slots: false,
              line_items: [
                {
                  service_id: 'a6994150-dfb5-4bf9-822b-40b0511a0539',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 2,
                  unit_price: 46,
                  total: 92,
                },
                {
                  service_id: '8a5740a1-2681-438e-9248-0309fe92bc15',
                  service_name: 'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
                  quantity: 1,
                  unit_price: 25,
                  total: 25,
                },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $117. That is $33 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, deodorizer, or another service to meet the minimum?',
            },
          }),
        },
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'partial_match', args: { hallway_count: 1 } },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $117.',
            data: {
              quote_total: 117,
              minimum_booking_amount: 150,
              amount_needed_to_minimum: 33,
              meets_minimum: false,
              can_offer_slots: false,
              line_items: [
                {
                  service_id: 'a6994150-dfb5-4bf9-822b-40b0511a0539',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 2,
                  unit_price: 46,
                  total: 92,
                },
                {
                  service_id: '8a5740a1-2681-438e-9248-0309fe92bc15',
                  service_name: 'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
                  quantity: 1,
                  unit_price: 25,
                  total: 25,
                },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $117. That is $33 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, deodorizer, or another service to meet the minimum?',
            },
          }),
        },
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $92.',
            data: {
              quote_total: 92,
              minimum_booking_amount: 150,
              amount_needed_to_minimum: 58,
              meets_minimum: false,
              can_offer_slots: false,
              line_items: [
                {
                  service_id: 'a6994150-dfb5-4bf9-822b-40b0511a0539',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 2,
                  unit_price: 46,
                  total: 92,
                },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $92. That is $58 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, deodorizer, or another service to meet the minimum?',
            },
          }),
        },
      ],
      dynamic_variables: {},
    },
  })

  console.log(JSON.stringify(definition, null, 2))
  return definition
}

async function createRecleanRefundTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Mike.
You are testing a carpet cleaning assistant.

## Goal
You had a carpet spot treated recently and the spot came back. You start by asking for a refund and give order number 7891273.

## Behavior
If the assistant offers a no-charge reclean instead of a refund, accept that option. Provide these details when asked:
- phone: 719-749-8807
- email: mike@example.com
- service address: 740 Platt Lane, Palmer Lake, CO 80133
- issue summary: treated spot in the living room came back
Ask for the earliest available reclean appointment and choose Tuesday, May 5, 2026 at 10:00 AM if offered.`,
      metrics: [
        'The agent does not transfer the call or say a specialist team is required.',
        'The agent does not call notify_admin before attempting the reclean path.',
        'The agent offers a no-charge reclean for the spot that came back.',
        'The agent collects or uses caller contact details and the order number before scheduling.',
        'The agent calls list_caller_appointments before scheduling the reclean.',
        'The agent calls schedule_reclean before saying the reclean is scheduled.',
        'The agent confirms the no-charge reclean only after schedule_reclean succeeds.',
      ],
      tool_mocks: [
        {
          tool_name: 'list_caller_appointments',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message:
              'Found 1 completed appointment from the last 30 days. Use the most recent one unless the caller corrects you.',
            data: {
              recommended_appointment: {
                id: 'original-test-appointment-id',
                appointment_date: '2026-04-28',
                start_time: '10:00:00',
                end_time: '12:00:00',
                status: 'completed',
                customer_name: 'Mike',
                customer_phone: '+17197498807',
                customer_email: 'mike@example.com',
                address: {
                  street_1: '740 Platt Lane',
                  city: 'Palmer Lake',
                  state: 'CO',
                  zip_code: '80133',
                },
                services: [{ name: 'Carpet cleaning', quantity: 1 }],
              },
              appointments: [],
            },
          }),
        },
        {
          tool_name: 'get_calendar_slots',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Found 2 available slots.',
            data: {
              date: '2026-05-05',
              required_minutes: 120,
              slots: [
                { start_time: '10:00:00', end_time: '12:00:00' },
                { start_time: '13:00:00', end_time: '15:00:00' },
              ],
            },
          }),
        },
        {
          tool_name: 'schedule_reclean',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Reclean appointment scheduled.',
            data: {
              appointment_id: 'reclean-test-appointment-id',
              invoice_id: 'reclean-test-invoice-id',
              original_appointment_id: 'original-test-appointment-id',
              appointment_date: '2026-05-05',
              start_time: '10:00:00',
              end_time: '12:00:00',
              status: 'booked',
              payment_status: 'waived',
              caller_script:
                'You are all set. I scheduled the no-charge reclean for Tuesday, May 5 at 10:00 AM.',
            },
          }),
        },
        {
          tool_name: 'notify_admin',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Mock admin notification only.',
          }),
        },
      ],
      dynamic_variables: {},
    },
  })

  console.log(JSON.stringify(definition, null, 2))
  return definition
}

async function createRefundRefusalFollowupTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Mike.
You are testing a carpet cleaning assistant.

## Goal
You had a treated spot come back and you want a refund, not a reclean.

## Behavior
Refuse the no-charge reclean once. Provide these details when asked:
- phone: 719-749-8807
- email: mike.june99@example.com
- service address: 123 Maple Street, Monument, CO 80132
- order number: 7891273
- issue summary: treated spot returned after cleaning
Ask what happens next and whether the refund is guaranteed.
If the assistant asks whether anything else should be added to the note, say: "No, that covers it. Thanks for sending it to the team."
After the assistant says the team has the details, no refund is guaranteed on the call, and the team will review or follow up, do not ask more questions; say thanks and end the conversation.`,
      metrics: [
        'The agent does not promise a refund.',
        'The agent asks for or uses a real callback phone number before notifying admin.',
        'The agent calls notify_admin with the customer name, real phone, email, address, order number, and issue summary.',
        'The agent tells the caller the team has the details and will review or follow up.',
        'The agent does not hang up immediately after notify_admin without an explanation.',
      ],
      tool_mocks: [
        {
          tool_name: 'notify_admin',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Mock admin notification sent.',
          }),
        },
      ],
      dynamic_variables: {},
    },
  })

  console.log(JSON.stringify(definition, null, 2))
  return definition
}

async function waitForRun(batchId, timeoutMs = 120_000) {
  const started = Date.now()
  let latestRuns = []
  while (Date.now() - started < timeoutMs) {
    const runs = await retellRequest(
      `/v2/list-test-runs/${encodeURIComponent(batchId)}?limit=10`,
    )
    latestRuns = runs.items || []
    const unfinished = latestRuns.filter((run) => run.status === 'in_progress')
    if (latestRuns.length > 0 && unfinished.length === 0) return latestRuns
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  return latestRuns
}

async function runTestDefinitions(args, definitions) {
  const batch = await retellRequest('/create-batch-test', {
    method: 'POST',
    body: {
      test_case_definition_ids: definitions.map(
        (definition) => definition.test_case_definition_id,
      ),
      response_engine: {
        type: 'conversation-flow',
        conversation_flow_id: args.flowId,
        version: args.flowVersion,
      },
    },
  })

  console.log(`Created batch ${batch.test_case_batch_job_id}`)
  const runs = await waitForRun(batch.test_case_batch_job_id)
  console.log(JSON.stringify(runs, null, 2))
  for (const run of runs) {
    if (run.test_case_job_id) {
      await importTestRun({ ...args, runId: run.test_case_job_id })
    }
  }
  return runs
}

async function runSmokeTest(args) {
  const definition = await createSmokeTestDefinition(args)
  await runTestDefinitions(args, [definition])
}

async function runRegressionSuite(args) {
  const timestamp = new Date().toISOString()
  const definitions = await Promise.all([
    createSmokeTestDefinition({
      ...args,
      name: `Rabecca regression booking success ${timestamp}`,
    }),
    createMinimumAddOnLoopTestDefinition({
      ...args,
      name: `Rabecca regression minimum add-on loop ${timestamp}`,
    }),
    createRecleanRefundTestDefinition({
      ...args,
      name: `Rabecca regression reclean refund path ${timestamp}`,
    }),
    createRefundRefusalFollowupTestDefinition({
      ...args,
      name: `Rabecca regression refund refusal followup ${timestamp}`,
    }),
  ])
  await runTestDefinitions(args, definitions)
}

async function listTestRuns(args) {
  if (!args.batchId) throw new Error('Pass --batch-id.')
  const runs = await retellRequest(
    `/v2/list-test-runs/${encodeURIComponent(args.batchId)}?limit=${args.limit}`,
  )
  console.log(JSON.stringify(runs, null, 2))
}

async function getTestRun(runId) {
  return retellRequest(`/get-test-run/${encodeURIComponent(runId)}`)
}

async function importTestRun(args) {
  if (!args.runId) throw new Error('Pass --run-id.')
  const run = await getTestRun(args.runId)
  const supabase = supabaseAdmin()
  const transcript = transcriptToText(run.transcript_snapshot)
  const definition = run.test_case_definition_snapshot || {}
  const callId = `retell-test:${run.test_case_job_id}`

  const { data: existing, error: existingError } = await supabase
    .from('retell_call_logs')
    .select('id')
    .eq('call_id', callId)
    .maybeSingle()
  if (existingError) throw existingError

  const payload = {
    call_id: callId,
    caller_phone: null,
    agent_id: args.flowId,
    agent_name: `Rabecca Test LLM: ${definition.name || 'Untitled'}`,
    call_status: `test_${run.status}`,
    call_type: 'retell_test_run',
    start_timestamp: timestampValue(run.creation_timestamp),
    end_timestamp: timestampValue(run.user_modified_timestamp),
    duration_seconds: null,
    transcript: transcript || null,
    recording_url: null,
    disconnection_reason: run.result_explanation || null,
    sentiment: null,
    call_successful: run.status === 'pass',
    raw_payload: run,
  }

  const query = existing
    ? supabase.from('retell_call_logs').update(payload).eq('id', existing.id)
    : supabase.from('retell_call_logs').insert(payload)

  const { error } = await query
  if (error) throw error
  console.log(`Imported ${callId} (${run.status}).`)
}

function printHelp() {
  console.log(`Usage:
  node scripts/retell-test-bridge.mjs list-definitions [--flow-id FLOW_ID] [--flow-version VERSION]
  node scripts/retell-test-bridge.mjs create-batch --test-case-id ID [--test-case-id ID]
  node scripts/retell-test-bridge.mjs list-runs --batch-id ID
  node scripts/retell-test-bridge.mjs import-run --run-id ID
  node scripts/retell-test-bridge.mjs create-smoke-test [--name NAME]
  node scripts/retell-test-bridge.mjs run-smoke-test [--name NAME]
  node scripts/retell-test-bridge.mjs run-regression-suite

Notes:
  - Manual Test LLM chats must be saved as test cases before the API can see them.
  - Imported test runs are stored in retell_call_logs with call_type=retell_test_run.
  - run-smoke-test uses mocked tool outputs, so it will not create a real appointment.
`)
}

async function main() {
  await loadEnv()
  const args = parseArgs(process.argv)

  if (args.command === 'list-definitions') {
    await listTestCaseDefinitions(args)
  } else if (args.command === 'create-batch') {
    await createBatchTest(args)
  } else if (args.command === 'list-runs') {
    await listTestRuns(args)
  } else if (args.command === 'import-run') {
    await importTestRun(args)
  } else if (args.command === 'create-smoke-test') {
    await createSmokeTestDefinition(args)
  } else if (args.command === 'run-smoke-test') {
    await runSmokeTest(args)
  } else if (args.command === 'run-regression-suite') {
    await runRegressionSuite(args)
  } else {
    printHelp()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
