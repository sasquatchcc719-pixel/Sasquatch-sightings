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
    llmId: '',
    llmVersion: 0,
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
    } else if (arg === '--llm-id') {
      args.llmId = argv[i + 1] || args.llmId
      i += 1
    } else if (arg === '--llm-version') {
      args.llmVersion = Number(argv[i + 1] || args.llmVersion)
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

function responseEngine(args) {
  if (args.llmId) {
    return {
      type: 'retell-llm',
      llm_id: args.llmId,
      version: args.llmVersion,
    }
  }

  return {
    type: 'conversation-flow',
    conversation_flow_id: args.flowId,
    version: args.flowVersion,
  }
}

function responseEngineId(args) {
  return args.llmId || args.flowId
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
  const milliseconds =
    Number(value) > 10_000_000_000 ? Number(value) : Number(value) * 1000
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null
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
  if (args.llmId) {
    url.searchParams.set('type', 'retell-llm')
    url.searchParams.set('llm_id', args.llmId)
  } else {
    url.searchParams.set('type', 'conversation-flow')
    url.searchParams.set('conversation_flow_id', args.flowId)
  }
  url.searchParams.set('limit', String(args.limit))

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(
      `Retell list-test-case-definitions failed: ${JSON.stringify(body)}`,
    )
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
      response_engine: responseEngine(args),
    },
  })

  console.log(JSON.stringify(batch, null, 2))
}

async function createSmokeTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
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

async function createUnavailableSlotGuardTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Donna.
You are testing a carpet cleaning booking assistant.

## Goal
Book four regular bedrooms of carpet cleaning for Sunday, May 3, 2026 at 9:00 AM.
Provide your contact details when asked:
- phone: 719-749-8807
- email: donna.calendar@example.com
- address: 740 Platt Lane, Palmer Lake, Colorado 80133

## Behavior
If the assistant says 9:00 AM is available, choose it. If the final booking tool says that time is no longer available, ask what other time is open and accept 11:00 AM if offered.`,
      metrics: [
        'The agent calls quote_and_prepare_booking before offering a residential appointment time.',
        'The agent calls book_prepared_slot before saying the job is booked.',
        'When book_prepared_slot returns failure for the selected time, the agent does not say the customer is booked.',
        'The agent offers the returned alternate 11:00 AM slot after the booking tool rejects 9:00 AM.',
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
              appointment_date: '2026-05-03',
              line_items: [
                {
                  service_id: 'a6994150-dfb5-4bf9-822b-40b0511a0539',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 4,
                  unit_price: 46,
                  total: 184,
                },
              ],
              slots: [{ start_time: '09:00:00', end_time: '11:00:00' }],
              caller_script:
                'The estimate is $184. I found this available window: 09:00:00 to 11:00:00. Which one works best?',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: {
            type: 'partial_match',
            args: { selected_start_time: '09:00' },
          },
          output: JSON.stringify({
            success: false,
            message:
              'Booking was NOT created: That appointment time is no longer available. Offer one of the returned available slots instead and do not say the customer is booked.',
            data: {
              appointment_date: '2026-05-03',
              requested_start_time: '09:00',
              available_slots: [
                { start_time: '11:00:00', end_time: '13:00:00' },
              ],
              caller_script:
                'That time is no longer available. I can offer 11:00:00 to 13:00:00 instead.',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: {
            type: 'partial_match',
            args: { selected_start_time: '11:00' },
          },
          output: JSON.stringify({
            success: true,
            message: 'Appointment booked.',
            data: {
              appointment_id: 'calendar-guard-success',
              appointment_date: '2026-05-03',
              start_time: '11:00:00',
              end_time: '13:00:00',
              quote_total: 184,
              line_items: [
                {
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 4,
                  total: 184,
                },
              ],
              caller_script:
                'You are all set for 2026-05-03 at 11:00:00. The total is $184.',
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

async function createMixedCarpetUpholsteryTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Rick James.
You are testing a carpet cleaning booking assistant.

## Goal
Book the next available appointment for:
- two regular bedrooms
- one 300 square-foot living room
- one couch

## Behavior
Provide your contact details when asked:
- phone: 719-749-8807
- email: clsewell970@gmail.com
- address: 740 Platt Lane, Palmer Lake, Colorado 80133
Do not let the assistant drop the couch. Ask for the total and confirmation that all three service types are included.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with two bedrooms, a 300 square-foot living room, and one couch or sofa.',
        'The agent quotes $332 for two regular bedrooms, one 300 square-foot living room, and one couch.',
        'The agent includes the couch or sofa in the service summary before booking.',
        'The agent calls book_prepared_slot before saying the appointment is booked.',
        'The agent confirms the booking after the booking tool succeeds and includes the couch or sofa in the booked services.',
        'The agent does not mention or apply any discount unless the booking tool explicitly includes one.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $332.',
            data: {
              quote_total: 332,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              appointment_date: '2026-05-04',
              line_items: [
                {
                  service_id: 'regular-room-test-id',
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 2,
                  unit_price: 46,
                  total: 92,
                },
                {
                  service_id: 'sasquatch-room-test-id',
                  service_name: 'Sasquatch Size Room (200 to 400 Sqft)',
                  quantity: 1,
                  unit_price: 90,
                  total: 90,
                },
                {
                  service_id: 'sofa-couch-test-id',
                  service_name: 'Sofa/Couch 3 Seat',
                  quantity: 1,
                  unit_price: 150,
                  total: 150,
                },
              ],
              missing_fields: [],
              slots: [
                { start_time: '09:00:00', end_time: '11:00:00' },
                { start_time: '11:00:00', end_time: '13:00:00' },
              ],
              caller_script:
                'The estimate is $332 for two regular bedrooms, one 300 square-foot living room, and one couch. I found 9 AM to 11 AM and 11 AM to 1 PM. Which one works best?',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message:
              'Booking confirmed! Confirmation number: TEST-MIXED-123. The customer will receive a confirmation text and email.',
            data: {
              appointment_id: 'mixed-test-appointment-id',
              confirmation_number: 'TEST-MIXED-123',
              appointment_status: 'booked',
              appointment_date: '2026-05-04',
              start_time: '09:00',
              end_time: '11:00',
              total: 332,
              line_items: [
                {
                  service_name: 'Regular Size Room (100 to 200 Sqft)',
                  quantity: 2,
                  unit_price: 46,
                  total: 92,
                },
                {
                  service_name: 'Sasquatch Size Room (200 to 400 Sqft)',
                  quantity: 1,
                  unit_price: 90,
                  total: 90,
                },
                {
                  service_name: 'Sofa/Couch 3 Seat',
                  quantity: 1,
                  unit_price: 150,
                  total: 150,
                },
              ],
              caller_script:
                "You're all set for Monday, May 4 at 9:00 AM. Services: two regular bedrooms, one 300 square-foot living room, and one couch. Total: $332. You'll receive confirmation with the details.",
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

async function createTileRugLegendaryCatalogTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Rick James.

## Goal
Book the next available appointment for kitchen tile and grout cleaning, one area rug, and Legendary/deep clean carpet:
- kitchen tile and grout is 500 square feet
- area rug is 5 by 8
- two regular bedrooms need the Legendary/deep clean

Provide contact details when asked:
- phone: 719-749-8807
- email: clsewell970@gmail.com
- address: 740 Platt Lane, Palmer Lake, Colorado 80133
Ask the assistant to confirm the price includes tile and grout, the rug, and Legendary/deep clean carpet.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with tile/grout, rug, and Legendary/deep clean carpet services.',
        'The agent quotes $557 for 500 square feet of tile/grout, one 5x8 rug, and two Legendary regular rooms.',
        'The agent includes tile/grout, rug, and Legendary/deep clean carpet in the service summary before booking.',
        'The agent calls book_prepared_slot before saying the appointment is booked.',
        'The final confirmation includes tile/grout, rug, Legendary/deep clean carpet, and the total.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $557.',
            data: {
              quote_total: 557,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              appointment_date: '2026-05-04',
              line_items: [
                {
                  service_name:
                    'Tile & grout cleaning (per Foot) pre-scrub and clean with Hydroforce',
                  quantity: 500,
                  unit_price: 0.75,
                  total: 375,
                },
                {
                  service_name: 'Area Rug 5x8',
                  quantity: 1,
                  unit_price: 32,
                  total: 32,
                },
                {
                  service_name:
                    'Legendary Restoration — Regular Room (100-200 sqft)',
                  quantity: 2,
                  unit_price: 75,
                  total: 150,
                },
              ],
              slots: [{ start_time: '09:00:00', end_time: '12:00:00' }],
              caller_script:
                'The estimate is $557 for tile and grout, one 5x8 rug, and two Legendary deep-clean rooms. I found 9 AM to noon.',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Booking confirmed.',
            data: {
              appointment_date: '2026-05-04',
              start_time: '09:00',
              total: 557,
              line_items: [
                { service_name: 'Tile & grout cleaning', quantity: 500 },
                { service_name: 'Area Rug 5x8', quantity: 1 },
                {
                  service_name:
                    'Legendary Restoration — Regular Room (100-200 sqft)',
                  quantity: 2,
                },
              ],
              caller_script:
                "You're all set for Monday, May 4 at 9 AM. Services: tile and grout, one 5x8 rug, and two Legendary deep-clean rooms. Total: $557.",
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

async function createTileCarpetCouchAddOnTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Rick James.

## Goal
Ask for pricing and availability for:
- 500 square feet of kitchen tile and grout
- a standard three-seat sofa
- a 250 square-foot carpeted living room
- urine treatment for one room with a pet spot

Be clear that you want all four services included and ask for next week's availability.

## Behavior
You only want the quote and available time window in this test. Do not provide booking contact details, and do not try to finalize the appointment. Once the assistant quotes all four services and gives availability, say thanks and end the call.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with tile_grout_sqft, couch or sofa, living room carpet square footage, urine_treatment_room_count, availability_start_date, and availability_days.',
        'The agent does not quote only the living room carpet or drop tile/grout, couch, or urine treatment.',
        'The agent quotes $640 for the complete service list.',
        'The agent does not quote or book the general deodorizer item marked not for urine.',
        'The agent offers only the dated availability returned by the tool and does not claim next week is unavailable.',
        'The agent does not invent add-on prices outside the tool result.',
        'When the user says thanks and ends the call, the agent gives one short goodbye and calls end_call.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $640.',
            data: {
              quote_total: 640,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              appointment_date: null,
              availability_start_date: '2026-05-04',
              availability_days: 7,
              line_items: [
                {
                  service_name: 'Tile & grout cleaning',
                  quantity: 500,
                  total: 375,
                },
                { service_name: 'Sasquatch Size Room', quantity: 1, total: 90 },
                { service_name: 'Sofa/ Couch 3 Seat', quantity: 1, total: 150 },
                {
                  service_name: 'Urine Eliminator Treatment',
                  quantity: 1,
                  total: 25,
                },
              ],
              slots: [
                {
                  date: '2026-05-05',
                  start_time: '09:00:00',
                  end_time: '12:00:00',
                },
              ],
              caller_script:
                'The estimate is $640. I found 2026-05-05 from 09:00:00 to 12:00:00.',
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

async function createTileOnlyQuoteCorrectionTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Rick James.

## Goal
Ask to book tile and grout cleaning for your home.
When asked for square footage, say it is about 400 square feet.
When asked about specific concerns, say no.
Ask for the price per foot if the assistant gives a total.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with tile_grout_sqft or a tile/grout service_request for the 400 square feet.',
        'The agent does not call quote_and_prepare_booking with living_room_sqft or hall_count as the only representation of the tile/grout job.',
        'The agent quotes $300 for 400 square feet of tile and grout at $0.75 per square foot.',
        'The agent does not first quote $163 or any carpet-room total for the tile/grout job.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $300.',
            data: {
              quote_total: 300,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: false,
              line_items: [
                {
                  service_name:
                    'Tile & grout cleaning (per Foot) pre-scrub and clean with Hydroforce',
                  quantity: 400,
                  unit_price: 0.75,
                  total: 300,
                },
              ],
              caller_script:
                'The estimate is $300 for 400 square feet of tile and grout cleaning.',
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

async function createFloodRestorationBlockedTestDefinition(args) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Mike.

## Goal
Try to book water extraction and drying because a pipe burst and the basement has standing water. Ask for a quote and the earliest appointment.`,
      metrics: [
        'The agent does not quote water extraction, drying equipment, or restoration line items as normal cleaning.',
        'The agent does not call quote_and_prepare_booking or book_prepared_slot for the water damage job.',
        'The agent treats the call as urgent water damage/flood restoration and routes to admin alert or transfer.',
      ],
      tool_mocks: [
        {
          tool_name: 'notify_admin',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Admin notified.',
            data: { alert_id: 'flood-test-alert' },
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
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: `## Identity
Your name is Mike.
You are testing a carpet cleaning booking assistant.

## Goal
You want carpet cleaning for two regular bedrooms. Ask for the earliest available date.
When the assistant says the two-bedroom quote is below the minimum, add one hallway and again ask for the updated total and earliest available date.

## Behavior
If the updated total is still below minimum, do not add more services. Ask what exactly is needed next. Also ask whether you can be put on a waitlist or notified about cancellations for the below-minimum job. If the assistant repeats that it needs the earliest available date, point out that you are asking the assistant for that date, not giving one.`,
      metrics: [
        'The agent quotes $92 for two regular bedrooms.',
        'After the hallway is added, the agent quotes $117.',
        'The agent says the updated job is still below the $150 minimum and $33 short.',
        'The agent does not ask the caller to provide the earliest available date.',
        'The agent does not offer appointment slots or claim a booking while the job is below minimum.',
        'The agent does not offer a waitlist, cancellation hold, or notification for a below-minimum job.',
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
                  service_name:
                    'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
                  quantity: 1,
                  unit_price: 25,
                  total: 25,
                },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $117. That is $33 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, urine treatment for pet spots, or another service to meet the minimum?',
            },
          }),
        },
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: {
            type: 'partial_match',
            args: { hallway_count: 1 },
          },
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
                  service_name:
                    'Hall/Bathroom/Closet Carpet cleaning 30 to 100 sqft',
                  quantity: 1,
                  unit_price: 25,
                  total: 25,
                },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $117. That is $33 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, urine treatment for pet spots, or another service to meet the minimum?',
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
                'The updated estimate is $92. That is $58 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet. Would you like to add another area, stairs, urine treatment for pet spots, or another service to meet the minimum?',
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
      response_engine: responseEngine(args),
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
        'The agent calls schedule_reclean before saying the reclean is scheduled, and does not say scheduled if that tool fails.',
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
      response_engine: responseEngine(args),
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

async function createAutonomousSmokeDefinition(args, scenario) {
  const definition = await retellRequest('/create-test-case-definition', {
    method: 'POST',
    body: {
      name: args.name,
      response_engine: responseEngine(args),
      llm_model: 'gpt-5.1',
      user_prompt: scenario.user_prompt,
      metrics: scenario.metrics,
      tool_mocks: scenario.tool_mocks,
      dynamic_variables: {},
    },
  })

  console.log(JSON.stringify(definition, null, 2))
  return definition
}

function autonomousSmokeScenarios(timestamp) {
  return [
    {
      name: `Rabecca autonomous flexible mixed booking ${timestamp}`,
      user_prompt: `## Identity
Your name is Alicia.

## Goal
Book tile and grout cleaning for 450 square feet plus one standard sofa. You are flexible, but want the earliest opening next week.

## Behavior
Ask for price and next week's availability first. If the assistant offers Wednesday May 6 at 11:00 AM, accept it. Provide contact details when asked:
- phone: 719-555-0184
- email: alicia.flex@example.com
- address: 55 Oak Ridge Road, Monument, CO 80132
End the conversation after the booking is confirmed.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with tile_grout_sqft, sofa/couch, availability_start_date, and availability_days.',
        'The agent quotes $487.50 from the tool and offers only the dated slot returned by the tool.',
        'The agent calls book_prepared_slot before saying the appointment is booked.',
        'The agent confirms the booking only after book_prepared_slot succeeds and includes tile/grout plus sofa.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $487.50.',
            data: {
              quote_total: 487.5,
              discount_applied: 0,
              total: 487.5,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              availability_start_date: '2026-05-04',
              availability_days: 7,
              line_items: [
                { service_name: 'Tile & grout cleaning', quantity: 450, total: 337.5 },
                { service_name: 'Sofa/ Couch 3 Seat', quantity: 1, total: 150 },
              ],
              slots: [
                {
                  date: '2026-05-06',
                  start_time: '11:00:00',
                  end_time: '14:00:00',
                },
              ],
              caller_script:
                'The estimate is $487.50. I found Wednesday May 6 from 11:00 AM to 2:00 PM.',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Appointment booked.',
            data: {
              appointment_id: 'auto-flex-booking',
              appointment_date: '2026-05-06',
              start_time: '11:00:00',
              end_time: '14:00:00',
              total: 487.5,
              line_items: [
                { service_name: 'Tile & grout cleaning', quantity: 450, total: 337.5 },
                { service_name: 'Sofa/ Couch 3 Seat', quantity: 1, total: 150 },
              ],
              caller_script:
                'You are all set for 2026-05-06 at 11:00:00. Total: $487.50.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous requested discount ${timestamp}`,
      user_prompt: `## Identity
Your name is Ben.

## Goal
Get a quote for 400 square feet of tile and grout cleaning. After hearing the price, ask if there are any discounts or deals available.

## Behavior
You only want the quote and discount answer. Do not book. After the assistant answers the discount question, say thanks and end the call.`,
      metrics: [
        'The first quote does not mention or apply a discount before the caller asks.',
        'After the caller asks for a discount, the agent calls quote_and_prepare_booking with discount_requested=true.',
        'The agent only mentions the $20 discount after the tool returns discount_applied greater than 0.',
        'The agent states the discounted total as $280 and does not invent any other discount.',
        'The agent calls end_call after the customer says thanks.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: {
            type: 'partial_match',
            args: { discount_requested: true },
          },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $280.',
            data: {
              quote_total: 300,
              discount_applied: 20,
              total: 280,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: false,
              line_items: [
                { service_name: 'Tile & grout cleaning', quantity: 400, total: 300 },
              ],
              slots: [],
              caller_script:
                'The estimate is $300. I applied the requested $20 discount, so the total is $280.',
            },
          }),
        },
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $300.',
            data: {
              quote_total: 300,
              discount_applied: 0,
              total: 300,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: false,
              line_items: [
                { service_name: 'Tile & grout cleaning', quantity: 400, total: 300 },
              ],
              slots: [],
              caller_script:
                'The estimate is $300. What day or date range would you like me to check?',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous below minimum pressure ${timestamp}`,
      user_prompt: `## Identity
Your name is Carol.

## Goal
Try to book two regular bedrooms only. When told it is below the minimum, ask for a waitlist, cancellation list, or exception because you do not want to add anything.

## Behavior
Do not accept add-ons. You want to know whether the assistant will hold a spot anyway. End once the assistant clearly says it cannot book or waitlist below minimum.`,
      metrics: [
        'The agent quotes $92 for two regular bedrooms from quote_and_prepare_booking.',
        'The agent says the job is below the $150 minimum and $58 short.',
        'The agent does not offer appointment times, a hold, waitlist, cancellation monitoring, or an exception.',
        'The agent gives a clear next step without looping.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
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
                { service_name: 'Regular Size Room (100 to 200 Sqft)', quantity: 2, total: 92 },
              ],
              missing_fields: [],
              caller_script:
                'The updated estimate is $92. That is $58 below our $150 minimum, so I cannot check appointment availability or finalize a booking yet.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous commercial estimate ${timestamp}`,
      user_prompt: `## Identity
Your name is Danielle.

## Goal
Schedule an estimate for a 6,000 square foot office carpet cleaning at Pine Creek Dental. It is commercial, recurring quarterly if the first cleaning goes well.

## Behavior
Provide details when asked:
- phone: 719-555-7722
- email: danielle@pinecreek.example
- address: 801 Corporate Center Drive, Colorado Springs, CO 80921
- preferred estimate time: Friday May 8, 2026 at 10:00 AM
Do not accept a residential quote; you want an estimate visit.`,
      metrics: [
        'The agent does not quote commercial work using residential pricing.',
        'The agent collects business/contact details, site address, square footage, floor type or service type, timeline, and recurring intent.',
        'The agent calls create_estimate before saying the estimate visit is scheduled.',
        'The agent only says the estimate is scheduled after create_estimate succeeds.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'create_estimate',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimate scheduled.',
            data: {
              estimate_id: 'auto-commercial-estimate',
              appointment_date: '2026-05-08',
              start_time: '10:00:00',
              caller_script:
                'You are set for an estimate visit on 2026-05-08 at 10:00 AM.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous appointment change ${timestamp}`,
      user_prompt: `## Identity
Your name is Evelyn.

## Goal
You have an appointment next Tuesday morning and need to move it to Friday afternoon. You do not know the confirmation number.

## Behavior
Provide contact details when asked:
- phone: 719-555-1313
- email: evelyn.change@example.com
- address: 12 Willow Trail, Monument, CO 80132
You need the team to follow up. End after the assistant confirms the request was sent, but do not let the assistant claim the appointment was actually changed.`,
      metrics: [
        'The agent does not say the appointment change is confirmed.',
        'The agent collects real callback phone, email, address, existing appointment timing, and requested new timing.',
        'The agent calls notify_admin with the change request and real contact details.',
        'The agent tells the caller the team will confirm the change.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'notify_admin',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Admin notification sent.',
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous rugs and leather quote ${timestamp}`,
      user_prompt: `## Identity
Your name is Frank.

## Goal
Get a quote and next-week availability for two 8x11 rugs and one leather sofa.

## Behavior
You only want pricing and available windows. Do not book. After the assistant quotes the rugs and leather sofa and offers a real returned window, say thanks and end the call.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with two 8x11 rugs and one leather sofa.',
        'The agent does not treat leather sofa as a standard fabric sofa.',
        'The agent quotes $390 from the tool and does not invent rug or leather pricing.',
        'The agent offers only the dated availability returned by the tool.',
        'The agent calls end_call after the customer says thanks.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $390.',
            data: {
              quote_total: 390,
              discount_applied: 0,
              total: 390,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              availability_start_date: '2026-05-04',
              availability_days: 7,
              line_items: [
                { service_name: 'Rug 8x11 wool or polyester', quantity: 2, total: 240 },
                { service_name: 'Leather Cleaning Sofa', quantity: 1, total: 150 },
              ],
              slots: [
                {
                  date: '2026-05-07',
                  start_time: '13:00:00',
                  end_time: '15:00:00',
                },
              ],
              caller_script:
                'The estimate is $390. I found 2026-05-07 from 13:00:00 to 15:00:00.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous pet stairs booking ${timestamp}`,
      user_prompt: `## Identity
Your name is Grace.

## Goal
Book cleaning for a 300 square-foot carpeted living room, 13 stairs, and urine treatment in one room for Monday May 4, 2026.

## Behavior
If the assistant offers 3:00 PM to 5:00 PM, accept it. Provide contact details when asked:
- phone: 719-555-4499
- email: grace.pet@example.com
- address: 9 Spruce Valley Lane, Monument, CO 80132
End after the booking is confirmed.`,
      metrics: [
        'The agent calls quote_and_prepare_booking with living_room_sqft, stairs_count, and urine_treatment_room_count.',
        'The agent quotes $167 from the tool and includes all three services.',
        'The agent calls book_prepared_slot before saying the appointment is booked.',
        'The final booking confirmation includes the living room, stairs, urine treatment, and $167 total.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $167.',
            data: {
              quote_total: 167,
              discount_applied: 0,
              total: 167,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              appointment_date: '2026-05-04',
              line_items: [
                { service_name: 'Sasquatch Size Room', quantity: 1, total: 90 },
                { service_name: 'Step Carpet Cleaning (Per Step Charge)', quantity: 13, total: 52 },
                { service_name: 'Urine Eliminator Treatment', quantity: 1, total: 25 },
              ],
              slots: [
                {
                  date: '2026-05-04',
                  start_time: '15:00:00',
                  end_time: '17:00:00',
                },
              ],
              caller_script:
                'The estimate is $167. I found 2026-05-04 from 15:00:00 to 17:00:00.',
            },
          }),
        },
        {
          tool_name: 'book_prepared_slot',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Appointment booked.',
            data: {
              appointment_id: 'auto-pet-stairs-booking',
              appointment_date: '2026-05-04',
              start_time: '15:00:00',
              end_time: '17:00:00',
              total: 167,
              line_items: [
                { service_name: 'Sasquatch Size Room', quantity: 1, total: 90 },
                { service_name: 'Step Carpet Cleaning (Per Step Charge)', quantity: 13, total: 52 },
                { service_name: 'Urine Eliminator Treatment', quantity: 1, total: 25 },
              ],
              caller_script:
                'You are all set for 2026-05-04 at 15:00:00. Total: $167.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous whole-house sqft qualifier ${timestamp}`,
      user_prompt: `## Identity
Your name is Tyler.

## Goal
You want a quote and next-week availability. Start by saying your house is roughly 3,000 square feet, you need the carpets cleaned, and you also have one sofa.

## Behavior
The 3,000 square feet is the total home size, not the carpet square footage. If the assistant asks what carpeted areas or actual carpet square footage need cleaning, clarify that it is three bedrooms and a living room that feels like about two average bedrooms, plus one sofa. Do not provide booking contact details. End after the assistant gives a quote and real availability.`,
      metrics: [
        'The agent treats the 3,000 square foot house size as context and asks a qualifying question before quoting.',
        'The agent does not call quote_and_prepare_booking with 3000 as carpet, living room, room, tile, or rug square footage.',
        'After clarification, the agent calls quote_and_prepare_booking with bedrooms_count, a large-room carpet input based on the bedroom-equivalent answer, couch or sofa, availability_start_date, and availability_days.',
        'The agent quotes only the tool result and offers only the returned dated availability.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $378.',
            data: {
              quote_total: 378,
              discount_applied: 0,
              total: 378,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              availability_start_date: '2026-05-04',
              availability_days: 7,
              line_items: [
                { service_name: 'Regular Size Room (100 to 200 Sqft)', quantity: 3, total: 138 },
                { service_name: 'Sasquatch Size Room (200 to 400 Sqft)', quantity: 1, total: 90 },
                { service_name: 'Sofa/ Couch 3 Seat', quantity: 1, total: 150 },
              ],
              slots: [
                {
                  date: '2026-05-06',
                  start_time: '12:00:00',
                  end_time: '15:00:00',
                },
              ],
              caller_script:
                'The estimate is $378. I found Wednesday May 6 from noon to 3:00 PM.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous room dimensions sizing ${timestamp}`,
      user_prompt: `## Identity
Your name is Dana.

## Goal
You want a quote and next-week availability for carpet cleaning in a living room that is roughly 30 by 15, plus 12 stairs.

## Behavior
If the assistant confirms that 30 by 15 is about 450 square feet, agree. Do not provide booking contact details. End after the assistant gives a quote and real availability.`,
      metrics: [
        'The agent understands 30 by 15 as about 450 square feet of cleanable carpet.',
        'The agent calls quote_and_prepare_booking with living_room_sqft around 450, stairs_count 12, availability_start_date, and availability_days.',
        'The agent quotes only the tool result and offers only the returned dated availability.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'quote_and_prepare_booking',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Estimated total is $186.',
            data: {
              quote_total: 186,
              discount_applied: 0,
              total: 186,
              minimum_booking_amount: 150,
              meets_minimum: true,
              can_offer_slots: true,
              availability_start_date: '2026-05-04',
              availability_days: 7,
              line_items: [
                { service_name: 'Monster Size Room (400 to 600 Sqft)', quantity: 1, total: 138 },
                { service_name: 'Step Carpet Cleaning (Per Step Charge)', quantity: 12, total: 48 },
              ],
              slots: [
                {
                  date: '2026-05-07',
                  start_time: '09:00:00',
                  end_time: '11:00:00',
                },
              ],
              caller_script:
                'The estimate is $186. I found Thursday May 7 from 9:00 AM to 11:00 AM.',
            },
          }),
        },
      ],
    },
    {
      name: `Rabecca autonomous sewage backup urgent ${timestamp}`,
      user_prompt: `## Identity
Your name is Henry.

## Goal
You have a sewage backup with standing water in the basement and wet carpet. You want emergency help and ask for a price and earliest appointment.

## Behavior
Provide contact details when asked:
- phone: 719-555-9000
- email: henry.water@example.com
- address: 44 Mesa View Drive, Colorado Springs, CO 80921
Do not accept a normal carpet cleaning quote. End after the assistant says the team has been alerted or Charles will follow up.`,
      metrics: [
        'The agent does not call quote_and_prepare_booking or book_prepared_slot for sewage backup or standing water.',
        'The agent treats the call as urgent water damage or flood restoration.',
        'The agent collects real callback details and affected address before or while alerting the team.',
        'The agent calls notify_admin with urgency urgent and a flood/water damage reason.',
        'The agent calls end_call after the customer is done.',
      ],
      tool_mocks: [
        {
          tool_name: 'notify_admin',
          input_match_rule: { type: 'any' },
          output: JSON.stringify({
            success: true,
            message: 'Urgent admin notification sent.',
          }),
        },
      ],
    },
  ]
}

async function runAutonomousSmokeSuite(args) {
  const timestamp = new Date().toISOString()
  const definitions = await Promise.all(
    autonomousSmokeScenarios(timestamp).map((scenario) =>
      createAutonomousSmokeDefinition(
        { ...args, name: scenario.name },
        scenario,
      ),
    ),
  )
  await runTestDefinitions(args, definitions)
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
      response_engine: responseEngine(args),
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
    createUnavailableSlotGuardTestDefinition({
      ...args,
      name: `Rabecca regression unavailable slot guard ${timestamp}`,
    }),
    createMixedCarpetUpholsteryTestDefinition({
      ...args,
      name: `Rabecca regression mixed carpet upholstery ${timestamp}`,
    }),
    createTileRugLegendaryCatalogTestDefinition({
      ...args,
      name: `Rabecca regression tile rug legendary catalog ${timestamp}`,
    }),
    createTileCarpetCouchAddOnTestDefinition({
      ...args,
      name: `Rabecca regression tile carpet couch add-on ${timestamp}`,
    }),
    createTileOnlyQuoteCorrectionTestDefinition({
      ...args,
      name: `Rabecca regression tile-only quote correction ${timestamp}`,
    }),
    createFloodRestorationBlockedTestDefinition({
      ...args,
      name: `Rabecca regression flood restoration blocked ${timestamp}`,
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
    agent_id: responseEngineId(args),
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
  node scripts/retell-test-bridge.mjs run-autonomous-smoke-suite

Notes:
  - Pass --llm-id LLM_ID [--llm-version VERSION] to target a prompt-driven Retell LLM instead of the default conversation flow.
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
  } else if (args.command === 'run-autonomous-smoke-suite') {
    await runAutonomousSmokeSuite(args)
  } else {
    printHelp()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
