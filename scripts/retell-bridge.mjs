#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const API_BASE = 'https://api.retellai.com'
const DEFAULT_OUT_DIR = '.retell/rabecca'
const DEFAULT_AGENT_MATCH = 'rabecca'
const DEFAULT_LINE_2_TRANSFER_NUMBER = '+17197498807'

function parseArgs(argv) {
  const args = {
    command: 'export',
    outDir: DEFAULT_OUT_DIR,
    agentMatch: DEFAULT_AGENT_MATCH,
    execute: false,
    cloneName: 'Rabecca Sandbox — Sasquatch Carpet Cleaning',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === 'export') {
      args.command = 'export'
    } else if (arg === 'clone') {
      args.command = 'clone'
    } else if (arg === 'rewrite-sandbox-v1') {
      args.command = 'rewrite-sandbox-v1'
    } else if (arg === '--out') {
      args.outDir = argv[i + 1] || args.outDir
      i += 1
    } else if (arg === '--agent-match') {
      args.agentMatch = (argv[i + 1] || args.agentMatch).toLowerCase()
      i += 1
    } else if (arg === '--clone-name') {
      args.cloneName = argv[i + 1] || args.cloneName
      i += 1
    } else if (arg === '--execute') {
      args.execute = true
    } else if (arg === '--help' || arg === '-h') {
      args.command = 'help'
    }
  }

  return args
}

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

async function loadApiKey() {
  await loadDotEnvFile('.env.local')
  await loadDotEnvFile('.env')
  const key = process.env.RETELL_API_KEY
  if (!key) {
    throw new Error(
      'RETELL_API_KEY is missing. Set it in your shell or ignored .env.local before running this bridge.',
    )
  }
  return key
}

async function retellFetch(apiKey, pathname, params = {}) {
  const url = new URL(`${API_BASE}${pathname}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
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
      `Retell API ${pathname} failed with ${response.status}: ${JSON.stringify(body)}`,
    )
  }

  return body
}

async function retellRequest(apiKey, pathname, options = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
      `Retell API ${pathname} failed with ${response.status}: ${JSON.stringify(body)}`,
    )
  }

  return body
}

function getItems(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.items)) return response.items
  if (Array.isArray(response?.agents)) return response.agents
  if (Array.isArray(response?.conversation_flows)) {
    return response.conversation_flows
  }
  return []
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value

  const redacted = {}
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (
      lower.includes('api_key') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('authorization')
    ) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = redact(child)
    }
  }
  return redacted
}

function stableJson(value) {
  return `${JSON.stringify(redact(value), null, 2)}\n`
}

function getAgentName(agent) {
  return (
    agent.agent_name ||
    agent.name ||
    agent.display_name ||
    agent.agent_id ||
    'unknown-agent'
  )
}

function findRabeccaAgent(agents, agentMatch) {
  return (
    agents.find((agent) =>
      String(getAgentName(agent)).toLowerCase().includes(agentMatch),
    ) || null
  )
}

function getAgentFlowId(agent) {
  return (
    agent?.conversation_flow_id ||
    agent?.response_engine?.conversation_flow_id ||
    agent?.response_engine?.id ||
    null
  )
}

function findFlowForAgent(flows, agent) {
  const flowId = getAgentFlowId(agent)
  if (!flowId) return null
  return (
    flows.find(
      (flow) => flow.conversation_flow_id === flowId || flow.id === flowId,
    ) || null
  )
}

function collectTools(agent, flow) {
  const tools = []
  if (Array.isArray(agent?.tools)) {
    tools.push(...agent.tools.map((tool) => ({ source: 'agent', ...tool })))
  }
  if (Array.isArray(agent?.response_engine?.tools)) {
    tools.push(
      ...agent.response_engine.tools.map((tool) => ({
        source: 'agent.response_engine',
        ...tool,
      })),
    )
  }
  if (Array.isArray(flow?.tools)) {
    tools.push(
      ...flow.tools.map((tool) => ({ source: 'conversation_flow', ...tool })),
    )
  }
  return tools
}

function summarizeTool(tool) {
  return {
    source: tool.source,
    type: tool.type,
    name: tool.name,
    method: tool.method,
    url: tool.url,
    payload_type: tool.payload_type || tool.payloadType || tool.payload,
    query_params: tool.query_params || tool.queryParams,
    parameters: tool.parameters,
  }
}

function buildSummary({ agent, flow, tools, agents, flows }) {
  const lines = [
    '# Rabecca Retell Export',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Matched Agent',
    '',
  ]

  if (agent) {
    lines.push(`- Name: ${getAgentName(agent)}`)
    lines.push(`- Agent ID: ${agent.agent_id || agent.id || 'unknown'}`)
    lines.push(`- Version: ${agent.version || 'unknown'}`)
    lines.push(
      `- Conversation Flow ID: ${getAgentFlowId(agent) || 'not found'}`,
    )
  } else {
    lines.push('- No Rabecca/Rebeccca-matching agent found.')
  }

  lines.push('', '## Matched Conversation Flow', '')
  if (flow) {
    lines.push(
      `- Flow ID: ${flow.conversation_flow_id || flow.id || 'unknown'}`,
    )
    lines.push(`- Version: ${flow.version || 'unknown'}`)
    lines.push(
      `- Nodes: ${Array.isArray(flow.nodes) ? flow.nodes.length : 'unknown'}`,
    )
    lines.push(`- Tools: ${Array.isArray(flow.tools) ? flow.tools.length : 0}`)
  } else {
    lines.push('- No conversation flow found from the matched agent.')
  }

  lines.push('', '## Tools', '')
  if (tools.length === 0) {
    lines.push('- No tools found on matched agent/flow.')
  } else {
    for (const tool of tools.map(summarizeTool)) {
      lines.push(`### ${tool.name || 'unnamed-tool'}`)
      lines.push('')
      lines.push(`- Source: ${tool.source || 'unknown'}`)
      lines.push(`- Type: ${tool.type || 'unknown'}`)
      lines.push(`- Method: ${tool.method || 'unknown'}`)
      lines.push(`- URL: ${tool.url || 'unknown'}`)
      lines.push(`- Payload Type: ${tool.payload_type || 'unknown'}`)
      lines.push('')
    }
  }

  lines.push('', '## Inventory', '')
  lines.push(`- Agents returned: ${agents.length}`)
  lines.push(`- Conversation flows returned: ${flows.length}`)
  lines.push('')

  return `${lines.join('\n')}\n`
}

function omitKeys(value, keysToOmit) {
  const result = {}
  for (const [key, child] of Object.entries(value || {})) {
    if (!keysToOmit.has(key)) result[key] = child
  }
  return result
}

function buildCloneFlowPayload(flow) {
  const payload = omitKeys(
    flow,
    new Set([
      'conversation_flow_id',
      'id',
      'version',
      'created_at',
      'updated_at',
      'last_modification_timestamp',
    ]),
  )

  return {
    ...payload,
    global_prompt: payload.global_prompt
      ? `${payload.global_prompt}\n\nSandbox note: this is the experimental Rabecca clone. Do not mention this note to callers.`
      : 'Sandbox note: this is the experimental Rabecca clone. Do not mention this note to callers.',
  }
}

function buildCloneAgentPayload(agent, flowResponse, cloneName) {
  const responseEngine = {
    type: 'conversation-flow',
    conversation_flow_id: flowResponse.conversation_flow_id,
    version: flowResponse.version,
  }

  const safeAgentFields = [
    'voice_id',
    'voice_model',
    'fallback_voice_ids',
    'voice_temperature',
    'voice_speed',
    'enable_dynamic_voice_speed',
    'enable_dynamic_responsiveness',
    'volume',
    'voice_emotion',
    'responsiveness',
    'interruption_sensitivity',
    'ambient_sound',
    'ambient_sound_volume',
    'backchannel_frequency',
    'backchannel_words',
    'language',
    'webhook_url',
    'boosted_keywords',
    'pronunciation_dictionary',
    'normalize_for_speech',
    'end_call_after_silence_ms',
    'max_call_duration_ms',
    'voicemail_option',
    'allow_user_dtmf',
    'user_dtmf_options',
    'denoising_mode',
    'data_storage_setting',
    'opt_in_signed_url',
    'pii_config',
    'post_call_analysis_model',
    'post_call_analysis_data',
    'timezone',
    'begin_message_delay_ms',
    'ring_duration_ms',
    'stt_mode',
    'vocab_specialization',
    'handbook_config',
  ]

  const payload = {
    response_engine: responseEngine,
    agent_name: cloneName,
    version_description: `Sandbox clone of ${getAgentName(agent)} created by retell-bridge.`,
  }

  for (const key of safeAgentFields) {
    if (agent?.[key] !== undefined) payload[key] = agent[key]
  }

  return payload
}

function currentBusinessDateForPrompt(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function buildSelfServeGlobalPrompt() {
  return `You are Rabecca with Sasquatch Carpet Cleaning.
Your job is to handle normal customer calls end-to-end: answer service questions, quote residential jobs, check real availability, book residential appointments, and schedule commercial estimate visits.

You are warm, calm, practical, and concise. You sound like a competent front-office scheduling assistant.

Current date:
- Today is ${currentBusinessDateForPrompt()} in America/Denver.
- Resolve "today", "tomorrow", weekdays, and "next Monday" relative to that date.
- Never use dates from 2024 or any past year.

CRITICAL — you have NO internal knowledge of:
- Prices, costs, minimum status, or rates for normal residential jobs. You MUST call quote_and_prepare_booking.
- Calendar availability or open time slots for normal residential jobs. You MUST use only slots returned by quote_and_prepare_booking.
- Whether a booking exists or was created. Only book_prepared_slot confirms a normal residential booking.
If you answer a pricing, availability, or booking question WITHOUT calling the tool first, you WILL give wrong information. NEVER guess. ALWAYS call the tool.

Core rules:
- Ask one question at a time.
- NEVER state a residential price without quote_and_prepare_booking data from THIS conversation.
- NEVER offer residential appointment times unless quote_and_prepare_booking returned can_offer_slots=true and explicit slots.
- NEVER say a normal residential job is booked unless book_prepared_slot returned success in THIS conversation.
- NEVER say an estimate is scheduled unless create_estimate returned success in THIS conversation.
- Do not hand off normal scheduling, quote, estimate, or intake calls.
- Use human fallback only for true exceptions: angry customers, disputes, unsafe situations, unsupported requests, or repeated tool failures.

Tool rules (mandatory, not optional):
- For normal residential quote and scheduling, use quote_and_prepare_booking first. It returns the quote, minimum status, missing fields, and real slots.
- If the caller adds, removes, or changes any service after a quote, immediately call quote_and_prepare_booking again with the complete updated service list before stating the new total, minimum status, or availability answer.
- For normal residential booking, use book_prepared_slot after the caller chooses one of the returned slots. Only say booked after this tool returns success.
- If quote_and_prepare_booking returns meets_minimum=false or can_offer_slots=false, do not offer dates or times. State the updated total, the amount still needed to meet the minimum, and ask what service they want to add.
- Use get_service_catalog only for general service questions outside normal residential quote-and-book flow.
- Use get_calendar_slots only for recleans or special non-residential scheduling paths that are not handled by quote_and_prepare_booking.
- Use create_estimate for commercial jobs or complex work that needs an on-site quote.
- Use notify_admin only when the request cannot be handled by the available tools. When using notify_admin, include message, reason, customer_name, customer_phone, customer_email, service_address, and urgency whenever available. These alerts are sent as Rabecca voice AI notifications, so the message must contain enough contact information for Charles to act on it.
- Never invent a main office phone number, manager phone number, website, email, or policy. If the caller asks for unavailable contact details, say you can send the team the details with notify_admin after collecting contact information.
- Never send placeholder contact fields like "[your phone number]" or "not provided" to a tool. If the caller ID is unavailable and you need team follow-up, ask for the caller's real callback phone number before calling notify_admin.

Residential intake:
For pricing, collect only job details first:
- what needs cleaned
- bedrooms count
- square footage only for large open rooms like living rooms, basements, great rooms, lofts, or open-concept spaces
- stairs and number of steps
- pet urine or odor concerns
- upholstery type and count if applicable, such as couch/sofa count, loveseat count, recliner count, or sectional seat count
- tile/grout square footage if applicable
- rug size or square footage if applicable
- whether carpet is standard cleaning or Legendary/deep clean

After collecting job details, call quote_and_prepare_booking to get actual prices and minimum status. Then tell the customer the price based ONLY on the tool response. Do not require name, phone, email, or address before quoting.
If the customer changes the job details after the quote, call quote_and_prepare_booking again before answering. Do not calculate the updated quote yourself.

Only after the customer wants availability or wants to book, collect:
- name, phone, email, full service address, city, ZIP
- preferred date or time

Bedroom rule:
Treat each bedroom as one regular room unless the customer says it is unusually large. Do not ask square footage for every bedroom.

Scheduling:
When the customer wants availability, call quote_and_prepare_booking with the complete service list and requested date. Offer only slots returned by quote_and_prepare_booking. After the customer chooses a slot, call book_prepared_slot with the same complete service list, selected slot, customer, and address. If book_prepared_slot succeeds, confirm the appointment with the date, time, total, and service list from the tool result. If it fails, explain the issue and offer an available alternative only if the tool provided one.

Commercial:
Do not quote commercial work using residential pricing. Collect business/contact details, site address, rough square footage, floor type, timeline, and whether it is one-time or recurring. Then call create_estimate to schedule the estimate visit.

Existing appointments:
If the caller wants to change or cancel an existing appointment, collect the appointment details and requested change. If no appointment-management tool exists, use notify_admin and tell the caller: "I have the change request noted and the team will confirm it."

Recleans / unhappy customers:
If the caller is unhappy with a completed cleaning, says a spot came back, wants a redo, warranty visit, or reclean, do not default to human fallback. If they ask for a refund because a spot came back, first offer to schedule a no-charge reclean; do not transfer or escalate before collecting details. Apologize briefly, collect caller name, real callback phone, email, service address, order/invoice number if available, original service date if available, issue summary, and preferred reclean day. Then use list_caller_appointments to look up completed appointments by phone, email, name, address, order number, or original service date. Use the most recent completed appointment unless the caller corrects you. If eligible, call get_calendar_slots before offering times, then call schedule_reclean after the caller chooses a real slot. Only say the reclean is scheduled after schedule_reclean returns success. Tell the caller there is no charge for the reclean. Escalate with notify_admin only after collecting a real callback phone or using caller ID if no matching appointment is found, the caller refuses a reclean and still demands a refund, or the caller is angry/escalating. After notify_admin succeeds, tell the caller the team has the details and Charles or the team will review and follow up as soon as possible. Do not mention refunds unless the caller asked for a refund.

Flood restoration / water damage:
If the caller mentions flood restoration, active water damage, water extraction, burst pipe, sewage backup, flooded basement, standing water, emergency drying, or similar urgent water-damage work, do not quote or schedule it as normal carpet cleaning. Collect caller name, phone, address, and a one-sentence summary if possible. Send an urgent admin alert, then transfer to line 2 / Charles. Say: "That sounds like a water-damage situation, so I’m going to get you over to Charles directly." If the transfer fails, tell the caller the team has been alerted and Charles will follow up as soon as possible.

Technical questions:
Answer simple service questions from the knowledge base. For permanent stains, bleach spots, carpet damage, subfloor contamination, water damage, or guarantees, give a careful non-guaranteed answer and offer to note it on the job. Use notify_admin only when follow-up is truly needed.

If asked if you are AI:
"Yes, I am an assistant that helps Sasquatch with scheduling, quotes, and missed calls."

Close:
- If booking tool succeeded: "You're all set for [date] at [time]. You'll receive confirmation with the details."
- If estimate tool succeeded: "You're set for an estimate visit on [date] at [time]."
- If a tool fails: "I'm having trouble confirming that live, so I noted it and the team will follow up."`
}

function updateNodeInstruction(flow, nodeName, text) {
  const node = flow.nodes?.find((item) => item.name === nodeName)
  if (!node) return
  node.instruction = { type: 'prompt', text }
}

function findToolId(flow, toolName) {
  return flow.tools?.find((tool) => tool.name === toolName)?.tool_id || null
}

function buildCustomTool(toolId, name, description, parameters) {
  return {
    headers: {},
    parameter_type: 'json',
    method: 'POST',
    query_params: {},
    description,
    enable_typing_sound: false,
    type: 'custom',
    url: 'https://sightings.sasquatchcarpet.com/api/retell/functions',
    tool_id: toolId,
    args_at_root: false,
    timeout_ms: 120000,
    speak_after_execution: true,
    name,
    response_variables: {},
    speak_during_execution: false,
    parameters,
  }
}

function upsertTool(flow, tool) {
  if (!Array.isArray(flow.tools)) flow.tools = []
  const existingIndex = flow.tools.findIndex((item) => item.name === tool.name)
  if (existingIndex >= 0) {
    flow.tools[existingIndex] = { ...flow.tools[existingIndex], ...tool }
  } else {
    flow.tools.push(tool)
  }
}

function upsertFunctionNode(flow, params) {
  const existing = flow.nodes?.find((node) => node.id === params.id)
  const node = {
    id: params.id,
    name: params.name,
    type: 'function',
    tool_id: params.toolId,
    tool_type: 'local',
    wait_for_result: true,
    speak_during_execution: false,
    enable_typing_sound: false,
    display_position: params.displayPosition,
    instruction: {
      type: 'static_text',
      text: params.instruction,
    },
    edges: params.nextNodeId
      ? [
          {
            id: `${params.id}-success`,
            destination_node_id: params.nextNodeId,
            transition_condition: {
              type: 'prompt',
              prompt: 'Tool completed successfully',
            },
          },
        ]
      : [],
    else_edge: params.elseNodeId
      ? {
          id: `${params.id}-else-edge`,
          destination_node_id: params.elseNodeId,
          transition_condition: {
            type: 'prompt',
            prompt: 'Else',
          },
        }
      : undefined,
  }

  if (existing) {
    Object.assign(existing, node)
  } else {
    flow.nodes.push(node)
  }
}

function upsertConversationNode(flow, params) {
  const existing = flow.nodes?.find((node) => node.id === params.id)
  const node = {
    id: params.id,
    name: params.name,
    type: 'conversation',
    display_position: params.displayPosition,
    instruction: {
      type: 'prompt',
      text: params.instruction,
    },
    edges:
      params.endAfterMessage === false
        ? []
        : [
            {
              id: `${params.id}-to-end`,
              destination_node_id: 'end-call-node-1777659262103',
              transition_condition: {
                type: 'prompt',
                prompt: 'Confirmation message has been spoken',
              },
            },
          ],
  }

  if (existing) {
    Object.assign(existing, node)
  } else {
    flow.nodes.push(node)
  }
}

function upsertTransferCallNode(flow, params) {
  const existing = flow.nodes?.find((node) => node.id === params.id)
  const node = {
    id: params.id,
    name: params.name,
    type: 'transfer_call',
    transfer_destination: {
      type: 'predefined',
      number: params.number,
    },
    transfer_option: {
      type: 'cold_transfer',
      show_transferee_as_caller: true,
      cold_transfer_mode: 'sip_invite',
      transfer_ring_duration_ms: 30000,
    },
    edge: {
      id: `${params.id}-failed`,
      destination_node_id: params.failedNodeId,
      transition_condition: {
        type: 'prompt',
        prompt: 'Transfer failed',
      },
    },
    speak_during_execution: true,
    instruction: {
      type: 'static_text',
      text: params.instruction,
    },
    display_position: params.displayPosition,
  }

  if (existing) {
    Object.assign(existing, node)
  } else {
    flow.nodes.push(node)
  }
}

function functionFallbackId(toolName) {
  return `function-${toolName.replace(/_/g, '-')}`
}

function findFunctionNodeId(flow, toolName) {
  const toolId = findToolId(flow, toolName)
  const existing = flow.nodes?.find(
    (node) => node.type === 'function' && node.tool_id === toolId,
  )
  return existing?.id || functionFallbackId(toolName)
}

function upsertEdgeToNode(flow, fromNodeName, toNodeId, prompt) {
  const node = flow.nodes?.find((item) => item.name === fromNodeName)
  if (!node) return

  const nextEdge = {
    id: `${node.id}-to-${toNodeId}`,
    destination_node_id: toNodeId,
    transition_condition: {
      type: 'prompt',
      prompt,
    },
  }

  const edges = Array.isArray(node.edges) ? node.edges : []
  const existingIndex = edges.findIndex(
    (edge) => edge.destination_node_id === toNodeId,
  )
  if (existingIndex >= 0) {
    edges[existingIndex] = nextEdge
  } else {
    edges.push(nextEdge)
  }
  node.edges = edges
}

function removeEdgeToNode(flow, fromNodeName, toNodeId) {
  const node = flow.nodes?.find((item) => item.name === fromNodeName)
  if (!node || !Array.isArray(node.edges)) return
  node.edges = node.edges.filter(
    (edge) => edge.destination_node_id !== toNodeId,
  )
}

function removeBrokenOrphanEdges(flow) {
  for (const node of flow.nodes || []) {
    if (!Array.isArray(node.edges)) continue
    node.edges = node.edges.filter((edge) => {
      const prompt = edge.transition_condition?.prompt || ''
      if (!edge.destination_node_id) return false
      if (prompt.includes('transfer to booking tool')) return false
      if (prompt === 'Details collected') return false
      return true
    })
  }
}

function rabeccaQuoteToolProperties() {
  return {
    service_request: {
      type: 'string',
      description:
        'Plain-English summary of what the customer asked to clean. Always include this. Example: "400 square feet of tile and grout cleaning". This lets the backend prevent category mixups.',
    },
    line_items: {
      type: 'array',
      description:
        'Optional catalog-backed service lines. Use catalog_slug, service_name, or service_id plus quantity or square_feet. Allowed normal services include carpet, Legendary deep clean, tile/grout, rugs, upholstery, deodorizer/treatments, and normal add-ons. Do not use for flood/water restoration.',
      items: {
        type: 'object',
        properties: {
          catalog_slug: { type: 'string' },
          service_name: { type: 'string' },
          service_id: { type: 'string' },
          quantity: { type: 'number' },
          square_feet: { type: 'number' },
        },
      },
    },
    bedrooms_count: {
      type: 'number',
      description: 'Number of regular bedrooms or regular rooms.',
    },
    living_room_sqft: {
      type: 'number',
      description:
        'Approximate square footage for one standard carpeted living room or open carpet area only. Never use this for tile/grout, rugs, or hard surfaces.',
    },
    tile_grout_sqft: {
      type: 'number',
      description:
        'Square footage for residential tile and grout cleaning. If the caller asks for tile or grout, put the square footage here, not in living_room_sqft or hall_count.',
    },
    rug_sqft: {
      type: 'number',
      description:
        'Square footage for a custom-size area rug when the preset rug size is unknown.',
    },
    rug_3x5_count: { type: 'number', description: 'Number of 3x5 rugs.' },
    runner_2_5x8_count: {
      type: 'number',
      description: 'Number of 2.5x8 runner rugs.',
    },
    rug_4x6_count: { type: 'number', description: 'Number of 4x6 rugs.' },
    rug_5x6_count: { type: 'number', description: 'Number of 5x6 rugs.' },
    rug_5x8_count: { type: 'number', description: 'Number of 5x8 rugs.' },
    rug_8x11_count: { type: 'number', description: 'Number of 8x11 rugs.' },
    rug_11x14_count: { type: 'number', description: 'Number of 11x14 rugs.' },
    legendary_regular_room_count: {
      type: 'number',
      description: 'Number of Legendary/deep clean regular rooms.',
    },
    legendary_room_sqft: {
      type: 'number',
      description:
        'Square footage for one Legendary/deep clean carpeted room or open area.',
    },
    legendary_hall_count: {
      type: 'number',
      description: 'Number of Legendary/deep clean small halls or closets.',
    },
    legendary_step_count: {
      type: 'number',
      description: 'Number of Legendary/deep clean stair steps or landings.',
    },
    couch_count: {
      type: 'number',
      description: 'Number of standard fabric three-seat sofas or couches.',
    },
    loveseat_count: {
      type: 'number',
      description: 'Number of standard fabric loveseats.',
    },
    recliner_count: {
      type: 'number',
      description: 'Number of standard fabric chairs or recliners.',
    },
    sectional_seat_count: {
      type: 'number',
      description: 'Number of seats/cushion sections for a fabric sectional.',
    },
    leather_chair_count: {
      type: 'number',
      description: 'Number of leather chairs.',
    },
    leather_loveseat_count: {
      type: 'number',
      description: 'Number of leather loveseats.',
    },
    leather_sofa_count: {
      type: 'number',
      description: 'Number of leather sofas.',
    },
    leather_sectional_seat_count: {
      type: 'number',
      description: 'Number of leather sectional seats.',
    },
    dining_chair_count: {
      type: 'number',
      description: 'Number of dining chairs.',
    },
    ottoman_count: { type: 'number', description: 'Number of ottomans.' },
    mattress_count: { type: 'number', description: 'Number of mattresses.' },
    deodorizer_room_count: {
      type: 'number',
      description: 'Number of rooms getting general deodorizer.',
    },
    urine_treatment_room_count: {
      type: 'number',
      description: 'Number of rooms getting urine eliminator treatment.',
    },
    pre_vacuuming_room_count: {
      type: 'number',
      description: 'Number of rooms getting pre-vacuuming.',
    },
    hall_count: {
      type: 'number',
      description: 'Number of halls, bathrooms, or closets to clean.',
    },
    stairs_count: {
      type: 'number',
      description: 'Number of individual stair steps.',
    },
    requested_date: {
      type: 'string',
      description: 'Requested appointment date in YYYY-MM-DD format.',
    },
  }
}

function addExplicitToolNodes(flow) {
  upsertTool(
    flow,
    buildCustomTool(
      'tool-rabecca-quote-prepare-booking',
      'quote_and_prepare_booking',
      'Deterministically quote a residential job, validate minimum booking rules, normalize the requested date, and return real available slots only when the job meets the minimum. Use this for normal residential quote and scheduling before attempting to book.',
      {
        type: 'object',
        properties: rabeccaQuoteToolProperties(),
      },
    ),
  )
  upsertTool(
    flow,
    buildCustomTool(
      'tool-rabecca-book-prepared-slot',
      'book_prepared_slot',
      'Create the residential booking after quote_and_prepare_booking returned a slot and the caller selected one. This tool revalidates quote, minimum, date, address, selected slot, and required customer fields before creating the appointment.',
      {
        type: 'object',
        properties: {
          ...rabeccaQuoteToolProperties(),
          selected_start_time: {
            type: 'string',
            description:
              'Selected appointment start time in HH:MM 24-hour format.',
          },
          customer: {
            type: 'object',
            description:
              'Customer name, phone, and email. Convert spelled emails to normal format when possible, for example c l s e w e l l nine seven zero at g mail dot com becomes clsewell970@gmail.com.',
            properties: {
              name: { type: 'string' },
              phone: {
                type: 'string',
                description:
                  'Best callback number, preferably 10 digits or E.164.',
              },
              email: {
                type: 'string',
                description:
                  'Normal email format, not spaced-out spoken words.',
              },
            },
            required: ['name', 'phone', 'email'],
          },
          address: {
            type: 'string',
            description:
              'Full service address including street, city, state, and ZIP. Use exactly what the caller confirmed.',
          },
        },
        required: [
          'requested_date',
          'selected_start_time',
          'customer',
          'address',
        ],
      },
    ),
  )
  upsertTool(
    flow,
    buildCustomTool(
      'tool-rabecca-list-caller-appointments',
      'list_caller_appointments',
      'Look up the caller’s prior Sasquatch appointments by caller phone, provided phone, email, customer name, service address, original service date, or order/invoice number. Use this when a customer is unhappy with prior work, says a spot came back, asks for a reclean, or requests a refund for a recent cleaning issue.',
      {
        type: 'object',
        properties: {
          lookup_phone: {
            type: 'string',
            description:
              'Optional phone number to look up. If omitted, the caller ID phone number is used.',
          },
          lookback_days: {
            type: 'number',
            description:
              'Optional lookback window. Defaults broad enough to find older completed jobs when the caller provides an original service date.',
          },
          appointment_status: {
            type: 'string',
            description:
              'Appointment status to look up. Use completed for reclean requests; the backend may also match prior booked/confirmed jobs on the calendar.',
          },
          order_number: {
            type: 'string',
            description:
              'Customer-provided order or invoice number, if available. Use this when the caller gives an order number.',
          },
          customer_name: {
            type: 'string',
            description: 'Customer name if provided.',
          },
          customer_email: {
            type: 'string',
            description: 'Customer email if provided.',
          },
          service_address: {
            type: 'string',
            description:
              'Service address where the original cleaning happened.',
          },
          original_service_date: {
            type: 'string',
            description:
              'Original cleaning date in YYYY-MM-DD format if the caller provides it.',
          },
        },
      },
    ),
  )
  upsertTool(
    flow,
    buildCustomTool(
      'tool-rabecca-schedule-reclean',
      'schedule_reclean',
      'Schedule a no-charge reclean / warranty redo for the caller after a matching prior appointment has been found and the caller has chosen an available time.',
      {
        type: 'object',
        properties: {
          original_appointment_id: {
            type: 'string',
            description:
              'The prior completed appointment ID from list_caller_appointments. If unsure, use the recommended appointment.',
          },
          appointment_date: {
            type: 'string',
            description: 'Reclean appointment date in YYYY-MM-DD format.',
          },
          start_time: {
            type: 'string',
            description: 'Reclean start time in HH:MM 24-hour format.',
          },
          issue_summary: {
            type: 'string',
            description:
              'Short summary of what the customer was unhappy with and what should be re-cleaned.',
          },
          duration_minutes: {
            type: 'number',
            description:
              'Optional reclean duration. Use 120 unless the job clearly needs longer.',
          },
          customer_name: {
            type: 'string',
            description: 'Customer name if provided.',
          },
          customer_email: {
            type: 'string',
            description: 'Customer email if provided.',
          },
          lookup_phone: {
            type: 'string',
            description: 'Customer callback phone if provided.',
          },
          service_address: {
            type: 'string',
            description:
              'Service address where the original cleaning happened.',
          },
          original_service_date: {
            type: 'string',
            description:
              'Original cleaning date in YYYY-MM-DD format if the caller provides it.',
          },
        },
        required: ['appointment_date', 'start_time', 'issue_summary'],
      },
    ),
  )

  const serviceCatalogToolId = findToolId(flow, 'get_service_catalog')
  const quotePrepareToolId = findToolId(flow, 'quote_and_prepare_booking')
  const bookPreparedToolId = findToolId(flow, 'book_prepared_slot')
  const slotsToolId = findToolId(flow, 'get_calendar_slots')
  const bookingToolId = findToolId(flow, 'create_booking')
  const estimateToolId = findToolId(flow, 'create_estimate')
  const appointmentLookupToolId = findToolId(flow, 'list_caller_appointments')
  const scheduleRecleanToolId = findToolId(flow, 'schedule_reclean')
  const notifyToolId = findToolId(flow, 'notify_admin')
  const serviceCatalogNodeId = findFunctionNodeId(flow, 'get_service_catalog')
  const quotePrepareNodeId = findFunctionNodeId(
    flow,
    'quote_and_prepare_booking',
  )
  const bookPreparedNodeId = findFunctionNodeId(flow, 'book_prepared_slot')
  const slotsNodeId = findFunctionNodeId(flow, 'get_calendar_slots')
  const bookingNodeId = findFunctionNodeId(flow, 'create_booking')
  const estimateNodeId = findFunctionNodeId(flow, 'create_estimate')
  const appointmentLookupNodeId = findFunctionNodeId(
    flow,
    'list_caller_appointments',
  )
  const scheduleRecleanNodeId = findFunctionNodeId(flow, 'schedule_reclean')
  const notifyNodeId = findFunctionNodeId(flow, 'notify_admin')
  const bookingConfirmedNodeId = 'node-rabecca-booking-confirmed'
  const belowMinimumEndNodeId = 'node-rabecca-below-minimum-end'
  const adminFollowupNodeId = 'node-rabecca-admin-followup'
  const adminCloseNodeId = 'node-rabecca-admin-close'
  const estimateConfirmedNodeId = 'node-rabecca-estimate-confirmed'
  const recleanIntakeNodeId = 'node-rabecca-reclean-intake'
  const recleanConfirmedNodeId = 'node-rabecca-reclean-confirmed'
  const recleanSlotsNodeId = 'function-rabecca-reclean-calendar-slots'
  const floodIntakeNodeId = 'node-rabecca-flood-intake'
  const floodAlertNodeId = 'function-rabecca-flood-alert'
  const floodTransferNodeId = 'node-rabecca-flood-transfer-line-2'
  const line2TransferNumber =
    process.env.REBECCA_LINE_2_TRANSFER_NUMBER || DEFAULT_LINE_2_TRANSFER_NUMBER

  upsertConversationNode(flow, {
    id: bookingConfirmedNodeId,
    name: 'Booking Confirmed',
    instruction:
      'Only enter this node after book_prepared_slot returned success. Use the tool result caller_script when available. Confirm the appointment date/time, total, and a brief service list from the booked line_items, including upholstery such as couch/sofa when present. Then end the call.',
    displayPosition: { x: 2140, y: -186 },
  })

  upsertConversationNode(flow, {
    id: belowMinimumEndNodeId,
    name: 'Below Minimum Not Bookable',
    instruction:
      'Use this only after quote_and_prepare_booking returned a below-minimum quote and the caller declines to add enough services to reach the minimum. Say: "I understand. With that scope, I cannot schedule or hold an appointment because it is below our $150 minimum. That also means I cannot put it on a waitlist or hold a cancellation spot for just those rooms. Your options are to add enough service to reach the minimum, combine it with another area or service, or stop here and call back if the scope changes." Then end the call.',
    displayPosition: { x: 2140, y: -30 },
  })

  upsertConversationNode(flow, {
    id: adminFollowupNodeId,
    name: 'Admin Follow-Up Confirmed',
    instruction:
      'Only enter this node after notify_admin succeeds. Do not hang up abruptly. Say: "I have sent those details to the team. Charles or the team will review it and follow up as soon as possible." If this is a reclean request, say: "I noted that you prefer a no-charge reclean." If the caller specifically asked for a refund, say: "I cannot promise a refund on this call." Ask if there is anything else they want added to the note. If the caller asks follow-up questions, answer briefly from policy: no exact review time is promised, no separate case number exists unless the tool returned one, and the team will use the provided callback phone or email. If the caller has nothing else, close politely with "Thanks for calling, and I’m sorry again for the trouble. We’ll have the team review this and follow up."',
    displayPosition: { x: 1880, y: 534 },
    endAfterMessage: false,
  })

  upsertConversationNode(flow, {
    id: adminCloseNodeId,
    name: 'Admin Follow-Up Close',
    instruction:
      'Close politely after the admin alert follow-up is complete. Say: "Thanks for calling, and I’m sorry again for the trouble. We’ll have the team review this and follow up." Then end the call.',
    displayPosition: { x: 2060, y: 534 },
  })

  upsertConversationNode(flow, {
    id: recleanIntakeNodeId,
    name: 'Complaint / Reclean Intake',
    instruction:
      'Handle customer dissatisfaction with prior work, including a spot that came back. Apologize briefly without blaming anyone. If the caller asks for a refund because a spot returned, first offer a no-charge reclean appointment; do not transfer, promise a refund, or notify admin before collecting details. Collect customer name, callback phone, email, service address, order/invoice number if available, original service date if available, concise issue summary, and preferred reclean day. Then use list_caller_appointments to find a prior job by phone, email, name, address, order number, or original service date. Never say you see, found, verified, or matched an order or prior job until list_caller_appointments returns success. Never call get_calendar_slots or schedule_reclean until list_caller_appointments has returned a matching prior appointment in this conversation. If a matching job is found, use get_calendar_slots before offering times. After the caller chooses a real slot, call schedule_reclean using the recommended_appointment.id from list_caller_appointments and include the caller contact/address details. If no matching job is found or the caller refuses a reclean and still demands a refund, call notify_admin with all collected details.',
    displayPosition: { x: 1060, y: 298 },
    endAfterMessage: false,
  })

  upsertConversationNode(flow, {
    id: recleanConfirmedNodeId,
    name: 'Reclean Confirmed',
    instruction:
      'Only enter this node after schedule_reclean returned success. Say: "You are all set. I scheduled the reclean for the confirmed date and time. There is no charge for that visit." Then end the call.',
    displayPosition: { x: 2140, y: 298 },
  })

  upsertConversationNode(flow, {
    id: estimateConfirmedNodeId,
    name: 'Estimate Confirmed',
    instruction:
      'Only enter this node after create_estimate returned success. Say: "You are set for an estimate visit at the confirmed date and time. You will receive confirmation with the details." Then end the call.',
    displayPosition: { x: 1660, y: 728 },
  })

  upsertConversationNode(flow, {
    id: floodIntakeNodeId,
    name: 'Flood / Water Damage Transfer',
    instruction:
      'Handle flood restoration, active water damage, water extraction, burst pipe, sewage backup, flooded basement, standing water, emergency drying, or similar urgent water-damage work. Do not quote or schedule it as normal carpet cleaning. Acknowledge urgency, collect caller name, callback phone, email if available, affected property address, and a one-sentence summary if possible. Then call notify_admin with reason "flood restoration", urgency "urgent", and all collected contact fields. After the alert tool succeeds, transfer the caller to line 2 / Charles.',
    displayPosition: { x: 1060, y: 606 },
    endAfterMessage: false,
  })

  if (quotePrepareToolId) {
    upsertFunctionNode(flow, {
      id: quotePrepareNodeId,
      name: 'Tool: Quote And Prepare Booking',
      toolId: quotePrepareToolId,
      nextNodeId: 'node-1777681751263',
      elseNodeId: 'node-1777681468014',
      instruction: 'Preparing the quote, minimum check, and real availability.',
      displayPosition: { x: 1260, y: -186 },
    })
  }
  if (bookPreparedToolId) {
    upsertFunctionNode(flow, {
      id: bookPreparedNodeId,
      name: 'Tool: Book Prepared Slot',
      toolId: bookPreparedToolId,
      nextNodeId: bookingConfirmedNodeId,
      elseNodeId: 'node-1777681751263',
      instruction: 'Creating the confirmed residential booking.',
      displayPosition: { x: 1880, y: -330 },
    })
  }

  if (serviceCatalogToolId) {
    upsertFunctionNode(flow, {
      id: serviceCatalogNodeId,
      name: 'Tool: Get Service Catalog',
      toolId: serviceCatalogToolId,
      nextNodeId: 'node-1777681751263',
      elseNodeId: 'node-1777681468014',
      instruction: 'Checking Sasquatch service options.',
      displayPosition: { x: 1260, y: -30 },
    })
  }
  if (slotsToolId) {
    upsertFunctionNode(flow, {
      id: slotsNodeId,
      name: 'Tool: Get Calendar Slots',
      toolId: slotsToolId,
      nextNodeId: 'node-1777681751263',
      elseNodeId: 'node-1777681751263',
      instruction: 'Checking real appointment availability.',
      displayPosition: { x: 1660, y: -186 },
    })
    upsertFunctionNode(flow, {
      id: recleanSlotsNodeId,
      name: 'Tool: Get Reclean Calendar Slots',
      toolId: slotsToolId,
      nextNodeId: recleanIntakeNodeId,
      elseNodeId: recleanIntakeNodeId,
      instruction:
        'Checking real appointment availability for a no-charge reclean.',
      displayPosition: { x: 1660, y: 298 },
    })
  }
  if (bookingToolId) {
    upsertFunctionNode(flow, {
      id: bookingNodeId,
      name: 'Tool: Create Booking',
      toolId: bookingToolId,
      nextNodeId: bookingConfirmedNodeId,
      elseNodeId: 'node-1777681751263',
      instruction: 'Creating the confirmed residential booking.',
      displayPosition: { x: 1880, y: -186 },
    })
  }
  if (estimateToolId) {
    upsertFunctionNode(flow, {
      id: estimateNodeId,
      name: 'Tool: Create Estimate',
      toolId: estimateToolId,
      nextNodeId: estimateConfirmedNodeId,
      elseNodeId: 'node-1777682351414',
      instruction: 'Creating the commercial or complex-job estimate visit.',
      displayPosition: { x: 1420, y: 606 },
    })
  }
  if (appointmentLookupToolId) {
    upsertFunctionNode(flow, {
      id: appointmentLookupNodeId,
      name: 'Tool: List Caller Appointments',
      toolId: appointmentLookupToolId,
      nextNodeId: recleanIntakeNodeId,
      elseNodeId: recleanIntakeNodeId,
      instruction: 'Looking up recent completed appointments for this caller.',
      displayPosition: { x: 1260, y: 298 },
    })
  }
  if (scheduleRecleanToolId) {
    upsertFunctionNode(flow, {
      id: scheduleRecleanNodeId,
      name: 'Tool: Schedule Reclean',
      toolId: scheduleRecleanToolId,
      nextNodeId: recleanConfirmedNodeId,
      elseNodeId: recleanIntakeNodeId,
      instruction: 'Scheduling the no-charge reclean appointment.',
      displayPosition: { x: 1880, y: 298 },
    })
  }
  if (notifyToolId) {
    upsertFunctionNode(flow, {
      id: notifyNodeId,
      name: 'Tool: Notify Admin',
      toolId: notifyToolId,
      nextNodeId: adminFollowupNodeId,
      elseNodeId: 'node-1777682450750',
      instruction:
        'Notifying the team about an exception or unsupported request.',
      displayPosition: { x: 1660, y: 534 },
    })
    upsertFunctionNode(flow, {
      id: floodAlertNodeId,
      name: 'Tool: Urgent Flood Alert',
      toolId: notifyToolId,
      nextNodeId: floodTransferNodeId,
      elseNodeId: floodTransferNodeId,
      instruction:
        'Sending Charles an urgent flood restoration / water damage alert before transfer.',
      displayPosition: { x: 1420, y: 606 },
    })
    upsertTransferCallNode(flow, {
      id: floodTransferNodeId,
      name: 'Transfer: Line 2 Flood Restoration',
      number: line2TransferNumber,
      failedNodeId: 'end-call-node-1777659262103',
      instruction:
        'That sounds like a water-damage situation, so I’m going to get you over to Charles directly.',
      displayPosition: { x: 1880, y: 606 },
    })
  }

  upsertEdgeToNode(
    flow,
    'Residential Intake',
    quotePrepareNodeId,
    'Customer has residential service details and needs a quote, minimum check, or appointment availability',
  )
  removeEdgeToNode(flow, 'Residential Intake', serviceCatalogNodeId)
  upsertEdgeToNode(
    flow,
    'Quote and Scheduling',
    quotePrepareNodeId,
    'Customer adds, removes, or changes residential services, or asks for an updated quote, updated minimum status, or availability after changing services',
  )
  upsertEdgeToNode(
    flow,
    'Quote and Scheduling',
    belowMinimumEndNodeId,
    'Customer declines to add services after a below-minimum residential quote, asks to book below the minimum anyway, or asks for availability while refusing to meet the minimum',
  )
  upsertEdgeToNode(
    flow,
    'Quote and Scheduling',
    slotsNodeId,
    'Customer has chosen services and wants available appointment times',
  )
  removeEdgeToNode(flow, 'Quote and Scheduling', slotsNodeId)
  upsertEdgeToNode(
    flow,
    'Quote and Scheduling',
    bookPreparedNodeId,
    'Customer has chosen an available slot and all required booking details are collected',
  )
  removeEdgeToNode(flow, 'Quote and Scheduling', bookingNodeId)
  upsertEdgeToNode(
    flow,
    'Quote and Scheduling',
    'node-1777684999992',
    'Customer no longer wants to book, is not interested, or wants to end the call',
  )
  upsertEdgeToNode(
    flow,
    'Commercial Intake',
    estimateNodeId,
    'Commercial estimate details and preferred time are collected',
  )
  upsertEdgeToNode(
    flow,
    'intent router',
    recleanIntakeNodeId,
    'Customer is unhappy with prior work, says a spot came back, wants a refund for a recent cleaning issue, wants a reclean, redo, warranty visit, or complaint help',
  )
  upsertEdgeToNode(
    flow,
    'intent router',
    floodIntakeNodeId,
    'Customer needs flood restoration, active water damage help, water extraction, burst pipe, sewage backup, flooded basement, standing water, or emergency drying',
  )
  upsertEdgeToNode(
    flow,
    'Residential Intake',
    floodIntakeNodeId,
    'Customer mentions flood restoration, water damage, water extraction, burst pipe, sewage backup, standing water, or emergency drying',
  )
  upsertEdgeToNode(
    flow,
    'Commercial Intake',
    floodIntakeNodeId,
    'Customer mentions flood restoration, water damage, water extraction, burst pipe, sewage backup, standing water, or emergency drying',
  )
  upsertEdgeToNode(
    flow,
    'Flood / Water Damage Transfer',
    floodAlertNodeId,
    'Caller details and water damage summary are collected or caller needs urgent transfer now',
  )
  upsertEdgeToNode(
    flow,
    'Existing Appointment Help',
    appointmentLookupNodeId,
    'Caller needs help with a recent completed appointment, complaint, reclean, redo, or warranty visit',
  )
  upsertEdgeToNode(
    flow,
    'Complaint / Reclean Intake',
    appointmentLookupNodeId,
    'Need to look up the caller’s prior appointments',
  )
  upsertEdgeToNode(
    flow,
    'Complaint / Reclean Intake',
    scheduleRecleanNodeId,
    'list_caller_appointments returned a matching prior appointment, get_calendar_slots returned the selected reclean slot, caller asks to book or confirm that slot, and issue summary is collected',
  )
  upsertEdgeToNode(
    flow,
    'Complaint / Reclean Intake',
    recleanSlotsNodeId,
    'list_caller_appointments returned a matching prior appointment and caller needs available reclean times but has not yet chosen a returned slot',
  )
  upsertEdgeToNode(
    flow,
    'Complaint / Reclean Intake',
    notifyNodeId,
    'No matching completed appointment was found after collecting customer details and a real callback phone, caller refuses a no-charge reclean and still demands a refund, or caller is angry/escalating',
  )
  upsertEdgeToNode(
    flow,
    'Admin Follow-Up Confirmed',
    adminCloseNodeId,
    'Caller says no, nothing else, thanks, goodbye, bye, or otherwise indicates the admin follow-up conversation is complete',
  )
  upsertEdgeToNode(
    flow,
    'Existing Appointment Help',
    notifyNodeId,
    'Appointment change or cancellation details are collected',
  )
  upsertEdgeToNode(
    flow,
    'Exception / Human Fallback',
    notifyNodeId,
    'Unsupported request or exception needs team follow-up',
  )
}

function completePlaceholderEdges(flow) {
  for (const node of flow.nodes || []) {
    if (node.name === 'Transfer to Charles') {
      node.name = 'Exception / Human Fallback'
    }
    for (const edge of node.edges || []) {
      const prompt = edge.transition_condition?.prompt || ''
      if (prompt === 'Describe the transition condition') {
        edge.transition_condition.prompt = 'Task is complete'
      } else if (prompt.includes('Charles')) {
        edge.transition_condition.prompt = prompt.replace(/or to Charles/g, '')
      }
    }
  }
}

function routeResidentialQuoteEdgesToTool(flow, quotePrepareNodeId) {
  const residentialNode = flow.nodes?.find(
    (node) => node.name === 'Residential Intake',
  )
  if (!residentialNode || !quotePrepareNodeId) return

  for (const edge of residentialNode.edges || []) {
    const prompt = edge.transition_condition?.prompt || ''
    if (prompt === 'Caller has given enough details for quote and scheduling') {
      edge.id = `${residentialNode.id}-to-${quotePrepareNodeId}`
      edge.destination_node_id = quotePrepareNodeId
      edge.transition_condition.prompt =
        'Customer has residential service details and needs a quote, minimum check, or appointment availability'
    }
  }

  const seenQuoteEdge = new Set()
  residentialNode.edges = (residentialNode.edges || []).filter((edge) => {
    if (edge.destination_node_id !== quotePrepareNodeId) return true
    const key = `${edge.destination_node_id}:${edge.transition_condition?.prompt || ''}`
    if (seenQuoteEdge.has(key)) return false
    seenQuoteEdge.add(key)
    return true
  })
}

function prioritizeEdge(flow, fromNodeName, firstDestinationNodeId) {
  const node = flow.nodes?.find((item) => item.name === fromNodeName)
  if (!node || !Array.isArray(node.edges)) return

  node.edges = [
    ...node.edges.filter(
      (edge) => edge.destination_node_id === firstDestinationNodeId,
    ),
    ...node.edges.filter(
      (edge) => edge.destination_node_id !== firstDestinationNodeId,
    ),
  ]
}

function removeDuplicateEdgeIds(flow) {
  const seen = new Set()
  for (const node of flow.nodes || []) {
    if (!Array.isArray(node.edges)) continue
    node.edges = node.edges.filter((edge) => {
      if (!edge.id) return true
      if (seen.has(edge.id)) return false
      seen.add(edge.id)
      return true
    })
  }
}

function buildSelfServeSandboxFlow(flow) {
  const nextFlow = structuredClone(flow)
  nextFlow.global_prompt = buildSelfServeGlobalPrompt()
  nextFlow.flex_mode = false

  updateNodeInstruction(
    nextFlow,
    'Welcome Node',
    'Say: "Hi, this is Rabecca with Sasquatch Carpet Cleaning. How can I help?" Then listen for the caller intent. Keep the opening short.',
  )
  updateNodeInstruction(
    nextFlow,
    'intent router',
    'Determine the caller intent and route them. Scheduling, pricing, and residential booking go to Residential Intake. Commercial work goes to Commercial Intake. Flood restoration, active water damage, water extraction, burst pipes, sewage backups, flooded basements, standing water, and emergency drying go to Flood / Water Damage Transfer. Complaints, spot came back, refund request after a recent cleaning issue, unhappy customers, recleans, redos, and warranty visits go to Complaint / Reclean Intake. Existing appointment changes go to Existing Appointment Help. Simple service questions should be answered directly when possible. Spam or sales calls go to Spam End.',
  )
  updateNodeInstruction(
    nextFlow,
    'Residential Intake',
    'Handle residential quote-first intake. Ask one question at a time. First ask what they need cleaned. If they mention flood restoration, active water damage, water extraction, burst pipes, sewage backup, flooded basement, standing water, or emergency drying, route to Flood / Water Damage Transfer and do not quote or schedule as normal cleaning. For normal pricing or scheduling, collect only service details first: standard or Legendary/deep carpet rooms and large-room square footage, halls/closets/bathrooms, stairs, tile/grout square footage, rug size or square footage, upholstery type/count, pet urine or odor concerns, deodorizer, and normal add-ons. Once you have enough details, call quote_and_prepare_booking with service_request plus the complete service list. If the caller asks for tile/grout, use tile_grout_sqft and never use living_room_sqft or hall_count for that square footage. Do not quote from memory and do not call separate catalog/calendar tools for normal booking.',
  )
  updateNodeInstruction(
    nextFlow,
    'Quote and Scheduling',
    'Use the result from quote_and_prepare_booking as the source of truth. Read its caller_script when helpful. If it says the job is below the minimum, state the updated total and the amount still needed. Do not offer dates, times, a waitlist, cancellation holds, or say you are checking availability while meets_minimum=false or can_offer_slots=false. If the caller asks for the earliest date, a cancellation, or a waitlist while below minimum, say you cannot check, hold, waitlist, or notify for appointment availability until the job reaches the $150 minimum, then give the options: add enough service to meet the minimum, combine it with another area/service, or stop there and call back if the scope changes. If the caller adds another service, call quote_and_prepare_booking again with all previous services plus the added service. If it returns slots, offer only those slots. Reuse any name, phone, email, address, date, and service details the customer already provided. Before calling book_prepared_slot, confirm one concise summary if any contact details were spoken unclearly: service, selected slot, customer name, phone, email, and full address. Convert spelled-out email into normal email format before sending the tool. After the customer chooses one returned slot and all required fields are collected, call book_prepared_slot. NEVER say the customer is booked unless book_prepared_slot returned success in this conversation. If book_prepared_slot fails, read the failure/next step and do not say booked.',
  )
  updateNodeInstruction(
    nextFlow,
    'Existing Appointment Help',
    'Help with existing appointment changes without pretending the change is already confirmed. For a complaint, unhappy customer, reclean, redo, or warranty visit, route to Complaint / Reclean Intake. For ordinary changes or cancellations, collect caller name, phone, email if available, known appointment date/time, service address if available, and requested change. Then call notify_admin with message, reason, customer_name, customer_phone, customer_email, service_address, and urgency. Tell the caller: "I have the change request noted and the team will confirm it."',
  )
  updateNodeInstruction(
    nextFlow,
    'Commercial Intake',
    'Handle commercial jobs by scheduling an estimate visit. Do not quote commercial work with residential pricing. If they mention flood restoration, active water damage, water extraction, burst pipes, sewage backup, flooded basement, standing water, or emergency drying, route to Flood / Water Damage Transfer. Otherwise collect business name, contact name, phone, email, site address, approximate square footage, floor type, timeline, and whether it is one-time or recurring. Ask for a preferred estimate date/time, call get_calendar_slots if needed, then call create_estimate. Only say the estimate is scheduled after create_estimate succeeds.',
  )
  updateNodeInstruction(
    nextFlow,
    'Transfer to Charles',
    'Use this only for true exceptions: angry customer, dispute, emergency, unsafe situation, repeated tool failure, or a request outside the available tools. Do not use this for ordinary scheduling, quotes, residential bookings, or commercial estimate scheduling. Before saying Charles will follow up, collect caller name, real callback phone if caller ID is unavailable, email if available, service address if relevant, and a concise reason. Call notify_admin with message, reason, customer_name, customer_phone, customer_email, service_address, and urgency. After notify_admin succeeds, explain that the team has the details, do not promise a refund, and close politely.',
  )
  updateNodeInstruction(
    nextFlow,
    'Spam End',
    'Say: "Sorry, I am only able to help customers looking to schedule service. Have a good day." Then end the call.',
  )
  updateNodeInstruction(
    nextFlow,
    "I'm sorry",
    'Say: "No problem. If you need carpet cleaning later, just give us a call. Have a good day." Then end the call.',
  )

  for (const tool of nextFlow.tools || []) {
    if (tool.name === 'get_service_catalog') {
      tool.description =
        'Retrieve Sasquatch Carpet Cleaning service names and pricing for general service questions only. For live quotes, minimum status, availability, or booking, use quote_and_prepare_booking instead.'
      tool.parameters.properties.category.description =
        'Optional Sasquatch service category filter, such as carpet, Legendary, upholstery, rug, tile, or deodorizer. Flood/water restoration is not self-bookable.'
    }
    if (tool.name === 'create_booking') {
      tool.description =
        'Create a confirmed residential cleaning appointment after the customer has confirmed services, time, contact info, and full address.'
    }
    if (tool.name === 'create_estimate') {
      tool.description =
        'Schedule an on-site estimate visit for commercial jobs or complex work that should not be quoted over the phone.'
    }
    if (tool.name === 'notify_admin') {
      tool.description =
        'Notify Charles through Rabecca voice AI alerts. Use only for exceptions, appointment change requests, disputes, urgent issues, flood restoration, or repeated tool failures. Include real contact details so Charles can act on the alert; do not send placeholder phone numbers.'
      tool.parameters = {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description:
              'Clear summary of what Charles needs to know or do. Must say this came from Rabecca if relevant.',
          },
          reason: {
            type: 'string',
            description:
              'Short reason/category, such as flood restoration, appointment change, dispute, tool failure, or unsupported request.',
          },
          customer_name: {
            type: 'string',
            description: 'Caller/customer name, if known.',
          },
          customer_phone: {
            type: 'string',
            description:
              'Best callback phone number. Use caller ID if the caller does not provide another number.',
          },
          customer_email: {
            type: 'string',
            description: 'Customer email, if known.',
          },
          service_address: {
            type: 'string',
            description:
              'Service address or affected property address, if known.',
          },
          urgency: {
            type: 'string',
            enum: ['normal', 'urgent'],
            description:
              'Use urgent for flood restoration, active water damage, angry customers, safety issues, or same-day problems.',
          },
        },
        required: ['message'],
      }
    }
    if (tool.name === 'list_caller_appointments') {
      tool.description =
        'Look up the caller’s prior appointments by phone, email, name, address, original service date, or order/invoice number before scheduling a reclean, redo, or warranty visit.'
    }
    if (tool.name === 'schedule_reclean') {
      tool.description =
        'Schedule a no-charge reclean / warranty redo after list_caller_appointments found a matching prior appointment and the caller selected a real available slot.'
    }
  }

  addExplicitToolNodes(nextFlow)
  routeResidentialQuoteEdgesToTool(
    nextFlow,
    findFunctionNodeId(nextFlow, 'quote_and_prepare_booking'),
  )
  prioritizeEdge(
    nextFlow,
    'Complaint / Reclean Intake',
    findFunctionNodeId(nextFlow, 'schedule_reclean'),
  )
  completePlaceholderEdges(nextFlow)
  removeBrokenOrphanEdges(nextFlow)
  removeDuplicateEdgeIds(nextFlow)

  return omitKeys(
    nextFlow,
    new Set([
      'conversation_flow_id',
      'id',
      'version',
      'created_at',
      'updated_at',
      'last_modification_timestamp',
      'is_published',
    ]),
  )
}

async function exportRetellConfig(args) {
  const apiKey = await loadApiKey()
  const [agentResponse, flowResponse] = await Promise.all([
    retellFetch(apiKey, '/list-agents', { limit: 1000, is_latest: true }),
    retellFetch(apiKey, '/v2/list-conversation-flows', { limit: 1000 }),
  ])

  const agents = getItems(agentResponse)
  const flows = getItems(flowResponse)
  const agent = findRabeccaAgent(agents, args.agentMatch)
  const flow = findFlowForAgent(flows, agent)
  const tools = collectTools(agent, flow)

  const outDir = path.resolve(args.outDir)
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, 'agents.json'), stableJson(agents))
  await writeFile(
    path.join(outDir, 'conversation-flows.json'),
    stableJson(flows),
  )
  await writeFile(path.join(outDir, 'agent.json'), stableJson(agent))
  await writeFile(path.join(outDir, 'conversation-flow.json'), stableJson(flow))
  await writeFile(path.join(outDir, 'tools.json'), stableJson(tools))
  await writeFile(
    path.join(outDir, 'summary.md'),
    buildSummary({ agent, flow, tools, agents, flows }),
  )

  console.log(`Exported Retell config to ${args.outDir}`)
  console.log(`Agents: ${agents.length}`)
  console.log(`Conversation flows: ${flows.length}`)
  console.log(`Matched agent: ${agent ? getAgentName(agent) : 'none'}`)
  console.log(`Matched tools: ${tools.length}`)
}

async function cloneRetellAgent(args) {
  const apiKey = await loadApiKey()
  const [agentResponse, flowResponse] = await Promise.all([
    retellFetch(apiKey, '/list-agents', { limit: 1000, is_latest: true }),
    retellFetch(apiKey, '/v2/list-conversation-flows', { limit: 1000 }),
  ])

  const agents = getItems(agentResponse)
  const flows = getItems(flowResponse)
  const agent = findRabeccaAgent(agents, args.agentMatch)
  const flow = findFlowForAgent(flows, agent)

  if (!agent || !flow) {
    throw new Error(
      'Could not find a matching Rabecca agent and flow to clone.',
    )
  }

  const flowPayload = buildCloneFlowPayload(flow)
  const dryRunAgentPayload = buildCloneAgentPayload(
    agent,
    {
      conversation_flow_id: 'DRY_RUN_FLOW_ID',
      version: 1,
    },
    args.cloneName,
  )

  const outDir = path.resolve(args.outDir)
  await mkdir(outDir, { recursive: true })
  await writeFile(
    path.join(outDir, 'clone-flow-payload.json'),
    stableJson(flowPayload),
  )
  await writeFile(
    path.join(outDir, 'clone-agent-payload.dry-run.json'),
    stableJson(dryRunAgentPayload),
  )

  if (!args.execute) {
    console.log('Dry run only. No Retell changes were made.')
    console.log(`Wrote clone payloads to ${args.outDir}`)
    console.log('Run again with --execute to create the sandbox clone.')
    return
  }

  const createdFlow = await retellRequest(apiKey, '/create-conversation-flow', {
    method: 'POST',
    body: flowPayload,
  })
  const agentPayload = buildCloneAgentPayload(
    agent,
    createdFlow,
    args.cloneName,
  )
  const createdAgent = await retellRequest(apiKey, '/create-agent', {
    method: 'POST',
    body: agentPayload,
  })

  await writeFile(
    path.join(outDir, 'created-flow.json'),
    stableJson(createdFlow),
  )
  await writeFile(
    path.join(outDir, 'created-agent.json'),
    stableJson(createdAgent),
  )
  await writeFile(
    path.join(outDir, 'clone-agent-payload.json'),
    stableJson(agentPayload),
  )

  console.log('Created Retell sandbox clone.')
  console.log(`Sandbox agent: ${getAgentName(createdAgent)}`)
  console.log(`Sandbox agent ID: ${createdAgent.agent_id || createdAgent.id}`)
  console.log(
    `Sandbox flow ID: ${
      createdFlow.conversation_flow_id || createdFlow.id || 'unknown'
    }`,
  )
}

async function rewriteSandboxV1(args) {
  const apiKey = await loadApiKey()
  const [agentResponse, flowResponse] = await Promise.all([
    retellFetch(apiKey, '/list-agents', { limit: 1000, is_latest: true }),
    retellFetch(apiKey, '/v2/list-conversation-flows', { limit: 1000 }),
  ])

  const agents = getItems(agentResponse)
  const flows = getItems(flowResponse)
  const agent = findRabeccaAgent(agents, args.agentMatch)
  const flow = findFlowForAgent(flows, agent)
  if (!agent || !flow) {
    throw new Error('Could not find a matching sandbox agent and flow.')
  }

  const flowId = flow.conversation_flow_id || flow.id
  const payload = buildSelfServeSandboxFlow(flow)
  const outDir = path.resolve(args.outDir)
  await mkdir(outDir, { recursive: true })
  await writeFile(
    path.join(outDir, 'rewrite-sandbox-v1-payload.json'),
    stableJson(payload),
  )

  if (!args.execute) {
    console.log('Dry run only. No Retell changes were made.')
    console.log(`Matched sandbox agent: ${getAgentName(agent)}`)
    console.log(`Matched sandbox flow: ${flowId}`)
    console.log(`Wrote rewrite payload to ${args.outDir}`)
    return
  }

  const updatedFlow = await retellRequest(
    apiKey,
    `/update-conversation-flow/${flowId}`,
    {
      method: 'PATCH',
      body: payload,
    },
  )
  await writeFile(
    path.join(outDir, 'updated-flow.json'),
    stableJson(updatedFlow),
  )
  console.log(`Updated sandbox flow: ${flowId}`)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.command === 'help') {
    console.log(
      [
        'Usage:',
        '  node scripts/retell-bridge.mjs export [--agent-match rabecca] [--out .retell/rabecca]',
        '  node scripts/retell-bridge.mjs clone [--agent-match rabecca] [--clone-name "Rabecca Sandbox"] [--out .retell/rabecca-sandbox] [--execute]',
        '  node scripts/retell-bridge.mjs rewrite-sandbox-v1 [--agent-match "rabecca sandbox"] [--out .retell/rabecca-sandbox] [--execute]',
        '',
        'Reads RETELL_API_KEY from the shell, .env.local, or .env.',
        'Export is read-only. Clone and rewrite commands are dry-run unless --execute is passed.',
      ].join('\n'),
    )
    return
  }

  if (args.command === 'clone') {
    await cloneRetellAgent(args)
  } else if (args.command === 'rewrite-sandbox-v1') {
    await rewriteSandboxV1(args)
  } else {
    await exportRetellConfig(args)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
