import type { SupabaseClient } from '@supabase/supabase-js'

export type HarryWorkflowIntent =
  | 'general'
  | 'new_booking'
  | 'appointment_lookup'
  | 'reschedule'
  | 'update_address'
  | 'update_services'
  | 'add_job_note'
  | 'cancel'
  | 'service_issue'

export type HarryWorkflowPhase =
  | 'idle'
  | 'gathering'
  | 'awaiting_customer'
  | 'action_failed'
  | 'completed'
  | 'escalated'

export type HarryWorkflowState = {
  conversation_id: string
  intent: HarryWorkflowIntent
  phase: HarryWorkflowPhase
  last_customer_message: string | null
  last_assistant_message: string | null
  last_action_name: string | null
  last_action_status: 'succeeded' | 'failed' | null
  last_action_error: string | null
  action_context: Record<string, unknown>
  turn_count: number
  last_customer_at: string | null
  last_assistant_at: string | null
}

export type HarryToolOutcome = {
  toolCallId?: string
  toolName: string
  args: Record<string, unknown>
  result: Record<string, unknown> | null
  success: boolean
  error: string | null
}

const MUTATING_TOOLS = new Set([
  'update_job_address',
  'reschedule_job',
  'update_job_line_items',
  'add_job_note',
  'book_new_job',
  'book_commercial_estimate',
])

const INTENT_BY_TOOL: Partial<Record<string, HarryWorkflowIntent>> = {
  update_job_address: 'update_address',
  reschedule_job: 'reschedule',
  update_job_line_items: 'update_services',
  add_job_note: 'add_job_note',
  book_new_job: 'new_booking',
  book_commercial_estimate: 'new_booking',
  list_my_upcoming_appointments: 'appointment_lookup',
}

const MUTATING_INTENTS = new Set<HarryWorkflowIntent>([
  'new_booking',
  'reschedule',
  'update_address',
  'update_services',
  'add_job_note',
])

function inferIntent(
  message: string,
  priorIntent: HarryWorkflowIntent = 'general',
): HarryWorkflowIntent {
  const text = message.toLowerCase()
  if (/\bcancel(?:ling|ing|led|ed)?\b/.test(text)) return 'cancel'
  if (
    /\b(reschedule|move|change)\b/.test(text) &&
    /\b(appointment|booking|day|date|time|later|earlier)\b/.test(text)
  ) {
    return 'reschedule'
  }
  if (
    /\b(address|street|zip|zipcode)\b/.test(text) &&
    /\b(change|update|wrong|new)\b/.test(text)
  ) {
    return 'update_address'
  }
  if (
    /\b(add|remove|instead|replace|change)\b/.test(text) &&
    /\b(room|rug|couch|sofa|stair|service|cleaning)\b/.test(text)
  ) {
    return 'update_services'
  }
  if (
    /\b(gate|garage|door|access|parking)\b/.test(text) &&
    /\b(code|note|instruction)\b/.test(text)
  ) {
    return 'add_job_note'
  }
  if (
    /\b(stain|odor|smell|damage|refund|complaint|not happy|still dirty)\b/.test(
      text,
    )
  ) {
    return 'service_issue'
  }
  if (
    /\b(when|what time|what date|appointment|scheduled)\b/.test(text) &&
    /\b(my|our|am i|are we)\b/.test(text)
  ) {
    return 'appointment_lookup'
  }
  if (/\b(book|schedule|appointment|availability|openings?)\b/.test(text)) {
    return 'new_booking'
  }
  return priorIntent
}

function isExplicitActionRequest(message: string): boolean {
  return inferIntent(message, 'general') !== 'general'
}

function fallbackState(conversationId: string): HarryWorkflowState {
  return {
    conversation_id: conversationId,
    intent: 'general',
    phase: 'idle',
    last_customer_message: null,
    last_assistant_message: null,
    last_action_name: null,
    last_action_status: null,
    last_action_error: null,
    action_context: {},
    turn_count: 0,
    last_customer_at: null,
    last_assistant_at: null,
  }
}

export function isHarryMutationTool(toolName: string): boolean {
  return MUTATING_TOOLS.has(toolName)
}

export async function loadHarryWorkflowState(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<HarryWorkflowState> {
  try {
    const { data, error } = await supabase
      .from('harry_workflow_states')
      .select('*')
      .eq('conversation_id', conversationId)
      .maybeSingle()

    if (error) throw error
    return data ? (data as HarryWorkflowState) : fallbackState(conversationId)
  } catch (error) {
    console.error('[Harry workflow] Failed to load state:', error)
    return fallbackState(conversationId)
  }
}

export async function beginHarryWorkflowTurn(params: {
  supabase: SupabaseClient
  conversationId: string
  customerMessage: string
}): Promise<HarryWorkflowState> {
  const prior = await loadHarryWorkflowState(
    params.supabase,
    params.conversationId,
  )
  const intent = inferIntent(params.customerMessage, prior.intent)
  const explicitAction = isExplicitActionRequest(params.customerMessage)
  const next: HarryWorkflowState = {
    ...prior,
    intent,
    phase: explicitAction ? 'gathering' : prior.phase,
    last_customer_message: params.customerMessage,
    turn_count: prior.turn_count + 1,
    last_customer_at: new Date().toISOString(),
  }

  try {
    const { error } = await params.supabase
      .from('harry_workflow_states')
      .upsert({
        ...next,
        updated_at: new Date().toISOString(),
      })
    if (error) throw error
  } catch (error) {
    console.error('[Harry workflow] Failed to begin turn:', error)
  }

  return next
}

export async function recordHarryToolOutcome(params: {
  supabase: SupabaseClient
  conversationId: string
  outcome: HarryToolOutcome
}): Promise<HarryWorkflowState> {
  const mutatesCustomerData = isHarryMutationTool(params.outcome.toolName)
  const error =
    params.outcome.error ||
    (typeof params.outcome.result?.error === 'string'
      ? params.outcome.result.error
      : null)

  try {
    const { error: ledgerError } = await params.supabase
      .from('harry_action_ledger')
      .upsert(
        {
          conversation_id: params.conversationId,
          tool_call_id: params.outcome.toolCallId || null,
          tool_name: params.outcome.toolName,
          mutates_customer_data: mutatesCustomerData,
          args: params.outcome.args,
          result: params.outcome.result,
          success: params.outcome.success,
          error,
        },
        params.outcome.toolCallId
          ? { onConflict: 'tool_call_id', ignoreDuplicates: true }
          : undefined,
      )
    if (ledgerError) throw ledgerError
  } catch (ledgerError) {
    console.error('[Harry workflow] Failed to record action:', ledgerError)
  }

  const prior = await loadHarryWorkflowState(
    params.supabase,
    params.conversationId,
  )
  if (!mutatesCustomerData) return prior

  const next: HarryWorkflowState = {
    ...prior,
    intent: INTENT_BY_TOOL[params.outcome.toolName] || prior.intent,
    phase: params.outcome.success ? 'completed' : 'action_failed',
    last_action_name: params.outcome.toolName,
    last_action_status: params.outcome.success ? 'succeeded' : 'failed',
    last_action_error: params.outcome.success ? null : error,
    action_context: {
      tool_name: params.outcome.toolName,
      args: params.outcome.args,
      result: params.outcome.result,
    },
  }

  try {
    const { error: stateError } = await params.supabase
      .from('harry_workflow_states')
      .upsert({ ...next, updated_at: new Date().toISOString() })
    if (stateError) throw stateError
  } catch (stateError) {
    console.error('[Harry workflow] Failed to update action state:', stateError)
  }

  return next
}

export async function recordHarryAssistantMessage(params: {
  supabase: SupabaseClient
  conversationId: string
  message: string
}): Promise<void> {
  try {
    const { error } = await params.supabase
      .from('harry_workflow_states')
      .update({
        last_assistant_message: params.message,
        last_assistant_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('conversation_id', params.conversationId)
    if (error) throw error
  } catch (error) {
    console.error('[Harry workflow] Failed to save assistant turn:', error)
  }
}

export function formatHarryWorkflowContext(state: HarryWorkflowState): string {
  const context = JSON.stringify(state.action_context || {})
  return `

DURABLE WORKFLOW STATE (authoritative across delayed replies):
- Intent: ${state.intent}
- Phase: ${state.phase}
- Last verified action: ${state.last_action_name || 'none'}
- Last action status: ${state.last_action_status || 'none'}
- Unresolved action error: ${state.last_action_error || 'none'}
- Last customer message: ${state.last_customer_message || 'none'}
- Verified action context: ${context === '{}' ? 'none' : context}

Rules:
- Continue this workflow even if the customer replied hours or days later.
- Database/tool results override conversational wording.
- If phase is action_failed, do not claim the action succeeded unless you successfully retry the correct tool now.
- If phase is completed, you may confirm the verified action, but do not repeat it or create a duplicate.
`
}

const SUCCESS_CLAIM_PATTERNS = [
  /\byou(?:'re| are) all set\b/i,
  /\bi(?:'ve| have) (?:booked|rescheduled|updated|saved|added|moved)\b/i,
  /\b(?:appointment|booking) (?:is|has been) (?:booked|confirmed|rescheduled|moved|updated)\b/i,
  /\b(?:got it|done)[—,: -]+i(?:'ve| have) (?:saved|added|updated)\b/i,
]

export function responseClaimsCompletedAction(response: string): boolean {
  return SUCCESS_CLAIM_PATTERNS.some((pattern) => pattern.test(response))
}

function customerSafeActionError(error: string | null): string {
  const lower = String(error || '').toLowerCase()
  if (
    lower.includes('slot_token') ||
    lower.includes('selected appointment slot')
  ) {
    return 'The selected appointment time could not be verified.'
  }
  if (lower.includes('appointment not found')) {
    return "I couldn't match the appointment to this phone number."
  }
  if (lower.includes('service') || lower.includes('catalog')) {
    return "I couldn't verify one or more of the requested services."
  }
  return 'The system did not confirm the change.'
}

export function guardHarryResponseAgainstOutcomes(params: {
  response: string
  workflowState: HarryWorkflowState
  outcomes: HarryToolOutcome[]
}): { response: string; blockedFalseClaim: boolean } {
  if (!responseClaimsCompletedAction(params.response)) {
    return { response: params.response, blockedFalseClaim: false }
  }

  const latestMutation = [...params.outcomes]
    .reverse()
    .find((outcome) => isHarryMutationTool(outcome.toolName))
  const verifiedPriorSuccess =
    !latestMutation &&
    params.workflowState.phase === 'completed' &&
    params.workflowState.last_action_status === 'succeeded'
  const failedMutation =
    latestMutation?.success === false ? latestMutation : undefined
  const unresolvedPersistedFailure =
    params.workflowState.last_action_status === 'failed'
  const mutationWorkflow = MUTATING_INTENTS.has(params.workflowState.intent)

  if (latestMutation?.success === true || verifiedPriorSuccess) {
    return { response: params.response, blockedFalseClaim: false }
  }

  if (!failedMutation && !unresolvedPersistedFailure && !mutationWorkflow) {
    return { response: params.response, blockedFalseClaim: false }
  }

  const error =
    failedMutation?.error || params.workflowState.last_action_error || null

  return {
    response: `I couldn't complete that change yet, so I won't tell you it's done. I'm flagging this for Charles to review. ${customerSafeActionError(error)}`,
    blockedFalseClaim: true,
  }
}
