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
    limit: 50,
    testCaseIds: [],
    batchId: '',
    runId: '',
  }

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--flow-id') {
      args.flowId = argv[i + 1] || args.flowId
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
        version: 0,
      },
    },
  })

  console.log(JSON.stringify(batch, null, 2))
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
  node scripts/retell-test-bridge.mjs list-definitions [--flow-id FLOW_ID]
  node scripts/retell-test-bridge.mjs create-batch --test-case-id ID [--test-case-id ID]
  node scripts/retell-test-bridge.mjs list-runs --batch-id ID
  node scripts/retell-test-bridge.mjs import-run --run-id ID

Notes:
  - Manual Test LLM chats must be saved as test cases before the API can see them.
  - Imported test runs are stored in retell_call_logs with call_type=retell_test_run.
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
  } else {
    printHelp()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
