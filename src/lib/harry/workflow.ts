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
  | 'awaiting_services'
  | 'awaiting_contact'
  | 'awaiting_appointment'
  | 'awaiting_date'
  | 'awaiting_slot'
  | 'ready_to_execute'
  | 'action_failed'
  | 'completed'
  | 'escalated'

export type HarryCollectedFields = {
  first_name?: string
  last_name?: string
  email?: string
  customer_phone?: string
  lead_source?: string
  street_1?: string
  street_2?: string
  city?: string
  state?: string
  zip_code?: string
  requested_date?: string
  selected_start_time?: string
  duration_minutes?: number
  accepted_minimum_charge?: boolean
  line_items?: Array<{ service_id: string; quantity: number }>
}

type HarryAppointmentRef = {
  ref: string
  appointment_id: string
  date?: string
  day_of_week?: string
  start_time?: string
  status?: string
  address?: string
}

type HarrySlotRef = {
  ref: string
  slot_token: string
  date: string
  day_of_week?: string
  start_time: string
  end_time?: string
  staff_label?: string | null
}

export type HarryServerRefs = {
  appointments?: HarryAppointmentRef[]
  selected_appointment_ref?: string
  slots?: HarrySlotRef[]
  selected_slot_ref?: string
  services?: Array<{
    ref: string
    service_id: string
    name?: string
    base_price?: number
  }>
}

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
  collected_fields: HarryCollectedFields
  missing_fields: string[]
  server_refs: HarryServerRefs
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

function normalizeClock(value: unknown): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
  if (!match) return ''
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`
}

function stringValue(value: unknown): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function numberValue(value: unknown): number | undefined {
  const normalized = Number(value)
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined
}

function collectFieldsFromMessage(
  message: string,
): Partial<HarryCollectedFields> {
  const fields: Partial<HarryCollectedFields> = {}
  const email = message.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0]
  if (email) fields.email = email.toLowerCase()

  const name = message.match(
    /(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]+)\s+([A-Z][a-z]+)/i,
  )
  if (name) {
    fields.first_name = name[1]
    fields.last_name = name[2]
  }

  const zip = message.match(/\b(80\d{3})\b/)?.[1]
  if (zip) fields.zip_code = zip

  return fields
}

function selectSlotFromMessage(
  message: string,
  slots: HarrySlotRef[],
): HarrySlotRef | null {
  if (slots.length === 0) return null
  const lower = message.toLowerCase()
  const explicitRef = lower.match(/\bslot[_\s-]?(\d+)\b/)?.[1]
  if (explicitRef) {
    return (
      slots.find((slot) => slot.ref === `slot_${Number(explicitRef)}`) || null
    )
  }

  const timeMatches = Array.from(
    lower.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/g),
  )
  for (const match of timeMatches) {
    let hour = Number(match[1])
    const minute = match[2] || '00'
    const meridiem = String(match[3] || '').replace(/\./g, '')
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    const normalized = `${String(hour).padStart(2, '0')}:${minute}`
    const exact = slots.find((slot) => slot.start_time === normalized)
    if (exact) return exact

    if (!meridiem && hour < 12) {
      const afternoon = `${String(hour + 12).padStart(2, '0')}:${minute}`
      const afternoonMatch = slots.find((slot) => slot.start_time === afternoon)
      if (afternoonMatch) return afternoonMatch
    }
  }
  return null
}

function collectFieldsFromToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): Partial<HarryCollectedFields> {
  const common: Partial<HarryCollectedFields> = {
    first_name: stringValue(args.first_name),
    last_name: stringValue(args.last_name),
    email: stringValue(args.email)?.toLowerCase(),
    customer_phone: stringValue(args.customer_phone),
    lead_source: stringValue(args.lead_source),
    street_1: stringValue(args.street_1),
    street_2: stringValue(args.street_2),
    city: stringValue(args.city),
    state: stringValue(args.state),
    zip_code: stringValue(args.zip_code),
    accepted_minimum_charge:
      typeof args.accepted_minimum_charge === 'boolean'
        ? args.accepted_minimum_charge
        : undefined,
  }

  if (toolName === 'get_calendar_slots') {
    common.requested_date = stringValue(args.date)
    common.duration_minutes = numberValue(args.duration_minutes)
  }
  if (toolName === 'reschedule_job') {
    common.requested_date = stringValue(args.new_appointment_date)
    common.selected_start_time = normalizeClock(args.new_start_time)
  }
  if (toolName === 'book_new_job' || toolName === 'book_commercial_estimate') {
    common.requested_date = stringValue(args.appointment_date)
    common.selected_start_time = normalizeClock(args.start_time)
  }
  if (Array.isArray(args.line_items)) {
    common.line_items = args.line_items
      .map((row) => {
        const item = row as { service_id?: unknown; quantity?: unknown }
        const serviceId = stringValue(item.service_id)
        if (!serviceId) return null
        return {
          service_id: serviceId,
          quantity: Math.max(1, Number(item.quantity) || 1),
        }
      })
      .filter(
        (
          row,
        ): row is {
          service_id: string
          quantity: number
        } => Boolean(row),
      )
  }

  return Object.fromEntries(
    Object.entries(common).filter(([, value]) => value !== undefined),
  )
}

function missingFieldsFor(
  intent: HarryWorkflowIntent,
  fields: HarryCollectedFields,
  refs: HarryServerRefs,
): string[] {
  if (intent === 'reschedule') {
    const missing: string[] = []
    if (
      !refs.selected_appointment_ref &&
      (refs.appointments?.length || 0) !== 1
    ) {
      missing.push('appointment')
    }
    if (!fields.requested_date) missing.push('requested_date')
    if (!fields.selected_start_time) missing.push('selected_start_time')
    return missing
  }

  if (intent === 'new_booking') {
    const required: Array<keyof HarryCollectedFields> = [
      'line_items',
      'first_name',
      'last_name',
      'email',
      'street_1',
      'city',
      'zip_code',
      'lead_source',
      'requested_date',
      'selected_start_time',
    ]
    return required.filter((field) => {
      const value = fields[field]
      return Array.isArray(value) ? value.length === 0 : !value
    })
  }

  return []
}

function derivePhase(
  intent: HarryWorkflowIntent,
  fields: HarryCollectedFields,
  refs: HarryServerRefs,
): HarryWorkflowPhase {
  const missing = missingFieldsFor(intent, fields, refs)
  if (intent === 'reschedule') {
    if (missing.includes('appointment')) return 'awaiting_appointment'
    if (missing.includes('requested_date')) return 'awaiting_date'
    if (missing.includes('selected_start_time')) return 'awaiting_slot'
    return 'ready_to_execute'
  }
  if (intent === 'new_booking') {
    if (missing.includes('line_items')) return 'awaiting_services'
    if (
      missing.some((field) =>
        [
          'first_name',
          'last_name',
          'email',
          'street_1',
          'city',
          'zip_code',
          'lead_source',
        ].includes(field),
      )
    ) {
      return 'awaiting_contact'
    }
    if (missing.includes('requested_date')) return 'awaiting_date'
    if (missing.includes('selected_start_time')) return 'awaiting_slot'
    return 'ready_to_execute'
  }
  return intent === 'general' ? 'idle' : 'gathering'
}

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
    collected_fields: {},
    missing_fields: [],
    server_refs: {},
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
    if (!data) return fallbackState(conversationId)
    return {
      ...(data as HarryWorkflowState),
      collected_fields:
        ((data as HarryWorkflowState)
          .collected_fields as HarryCollectedFields) || {},
      missing_fields:
        ((data as HarryWorkflowState).missing_fields as string[]) || [],
      server_refs:
        ((data as HarryWorkflowState).server_refs as HarryServerRefs) || {},
    }
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
  const next = advanceHarryWorkflowState(prior, params.customerMessage)
  await saveWorkflowState(params.supabase, next)
  return next
}

export function advanceHarryWorkflowState(
  prior: HarryWorkflowState,
  customerMessage: string,
): HarryWorkflowState {
  const intent = inferIntent(customerMessage, prior.intent)
  const serverRefs = prior.server_refs || {}
  const selectedSlot = selectSlotFromMessage(
    customerMessage,
    serverRefs.slots || [],
  )
  const collectedFields = {
    ...(prior.collected_fields || {}),
    ...collectFieldsFromMessage(customerMessage),
    ...(selectedSlot ? { selected_start_time: selectedSlot.start_time } : {}),
  }
  const nextServerRefs = selectedSlot
    ? { ...serverRefs, selected_slot_ref: selectedSlot.ref }
    : serverRefs
  const explicitAction = isExplicitActionRequest(customerMessage)
  const phase =
    explicitAction || Boolean(selectedSlot)
      ? derivePhase(intent, collectedFields, nextServerRefs)
      : prior.phase
  return {
    ...prior,
    intent,
    phase,
    collected_fields: collectedFields,
    missing_fields: missingFieldsFor(intent, collectedFields, nextServerRefs),
    server_refs: nextServerRefs,
    last_customer_message: customerMessage,
    turn_count: prior.turn_count + 1,
    last_customer_at: new Date().toISOString(),
  }
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
  const collectedFields = {
    ...(prior.collected_fields || {}),
    ...collectFieldsFromToolArgs(params.outcome.toolName, params.outcome.args),
  }
  const serverRefs = updateServerRefs(
    prior.server_refs || {},
    params.outcome.toolName,
    params.outcome.args,
    params.outcome.result,
  )
  const resolvedIntent = INTENT_BY_TOOL[params.outcome.toolName] || prior.intent

  if (!mutatesCustomerData) {
    const next: HarryWorkflowState = {
      ...prior,
      intent: resolvedIntent,
      phase: derivePhase(resolvedIntent, collectedFields, serverRefs),
      collected_fields: collectedFields,
      missing_fields: missingFieldsFor(
        resolvedIntent,
        collectedFields,
        serverRefs,
      ),
      server_refs: serverRefs,
    }
    await saveWorkflowState(params.supabase, next)
    return next
  }

  const next: HarryWorkflowState = {
    ...prior,
    intent: resolvedIntent,
    phase: params.outcome.success ? 'completed' : 'action_failed',
    last_action_name: params.outcome.toolName,
    last_action_status: params.outcome.success ? 'succeeded' : 'failed',
    last_action_error: params.outcome.success ? null : error,
    action_context: {
      tool_name: params.outcome.toolName,
      args: params.outcome.args,
      result: params.outcome.result,
    },
    collected_fields: collectedFields,
    missing_fields: params.outcome.success
      ? []
      : missingFieldsFor(resolvedIntent, collectedFields, serverRefs),
    server_refs: serverRefs,
  }

  await saveWorkflowState(params.supabase, next)

  return next
}

async function saveWorkflowState(
  supabase: SupabaseClient,
  state: HarryWorkflowState,
): Promise<void> {
  try {
    const { error } = await supabase.from('harry_workflow_states').upsert({
      ...state,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
  } catch (error) {
    console.error('[Harry workflow] Failed to update workflow state:', error)
  }
}

function updateServerRefs(
  refs: HarryServerRefs,
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | null,
): HarryServerRefs {
  if (!result) return refs
  if (toolName === 'list_my_upcoming_appointments') {
    const upcoming = Array.isArray(result.upcoming) ? result.upcoming : []
    const appointments: HarryAppointmentRef[] = []
    for (const [index, row] of upcoming.entries()) {
      const item = row as Record<string, unknown>
      const appointmentId = stringValue(item.appointment_id)
      if (!appointmentId) continue
      const date = stringValue(item.date)
      const dayOfWeek = stringValue(item.day_of_week)
      const startTime = normalizeClock(item.start_time)
      const status = stringValue(item.status)
      const address = stringValue(item.address)
      appointments.push({
        ref: `appointment_${index + 1}`,
        appointment_id: appointmentId,
        ...(date ? { date } : {}),
        ...(dayOfWeek ? { day_of_week: dayOfWeek } : {}),
        ...(startTime ? { start_time: startTime } : {}),
        ...(status ? { status } : {}),
        ...(address ? { address } : {}),
      })
    }
    return {
      ...refs,
      appointments,
      selected_appointment_ref:
        appointments.length === 1
          ? appointments[0].ref
          : refs.selected_appointment_ref,
    }
  }
  if (toolName === 'get_calendar_slots') {
    const date = stringValue(result.date) || stringValue(args.date) || ''
    const dayOfWeek = stringValue(result.day_of_week)
    const slots: HarrySlotRef[] = []
    for (const [index, row] of (Array.isArray(result.slots)
      ? result.slots
      : []
    ).entries()) {
      const item = row as Record<string, unknown>
      const token = stringValue(item.slot_token)
      const startTime = normalizeClock(item.start_time)
      if (!token || !date || !startTime) continue
      const endTime = normalizeClock(item.end_time)
      const staffLabel = stringValue(item.staff_label)
      slots.push({
        ref: `slot_${index + 1}`,
        slot_token: token,
        date,
        ...(dayOfWeek ? { day_of_week: dayOfWeek } : {}),
        start_time: startTime,
        ...(endTime ? { end_time: endTime } : {}),
        ...(staffLabel ? { staff_label: staffLabel } : {}),
      })
    }
    return { ...refs, slots }
  }
  if (toolName === 'search_service_catalog') {
    const services: NonNullable<HarryServerRefs['services']> = []
    for (const [index, row] of (Array.isArray(result.services)
      ? result.services
      : []
    ).entries()) {
      const item = row as Record<string, unknown>
      const serviceId = stringValue(item.id)
      if (!serviceId) continue
      const name = stringValue(item.name)
      const basePrice = numberValue(item.base_price)
      services.push({
        ref: `service_${index + 1}`,
        service_id: serviceId,
        ...(name ? { name } : {}),
        ...(basePrice !== undefined ? { base_price: basePrice } : {}),
      })
    }
    return { ...refs, services }
  }
  return refs
}

export function prepareHarryToolArgs(params: {
  toolName: string
  args: Record<string, unknown>
  workflowState: HarryWorkflowState
}): Record<string, unknown> {
  const args = { ...params.args }
  const refs = params.workflowState.server_refs || {}

  if (
    [
      'reschedule_job',
      'update_job_address',
      'update_job_line_items',
      'add_job_note',
    ].includes(params.toolName)
  ) {
    const requestedRef = stringValue(args.appointment_ref)
    const appointments = refs.appointments || []
    const appointment =
      appointments.find((row) => row.ref === requestedRef) ||
      (appointments.length === 1 ? appointments[0] : null)
    if (appointment) args.appointment_id = appointment.appointment_id
    delete args.appointment_ref
  }

  if (
    ['reschedule_job', 'book_new_job', 'book_commercial_estimate'].includes(
      params.toolName,
    )
  ) {
    const date =
      stringValue(
        params.toolName === 'reschedule_job'
          ? args.new_appointment_date
          : args.appointment_date,
      ) || params.workflowState.collected_fields.requested_date
    const startTime =
      normalizeClock(
        params.toolName === 'reschedule_job'
          ? args.new_start_time
          : args.start_time,
      ) || params.workflowState.collected_fields.selected_start_time
    const requestedRef = stringValue(args.slot_ref) || refs.selected_slot_ref
    const slots = refs.slots || []
    const slot =
      slots.find((row) => row.ref === requestedRef) ||
      slots.find((row) => row.date === date && row.start_time === startTime)
    if (slot) args.slot_token = slot.slot_token
    if (date) {
      if (params.toolName === 'reschedule_job') {
        args.new_appointment_date = date
      } else {
        args.appointment_date = date
      }
    }
    if (startTime) {
      if (params.toolName === 'reschedule_job') {
        args.new_start_time = startTime
      } else {
        args.start_time = startTime
      }
    }
    delete args.slot_ref
  }

  if (
    ['book_new_job', 'update_job_line_items'].includes(params.toolName) &&
    Array.isArray(args.line_items)
  ) {
    const services = refs.services || []
    args.line_items = args.line_items.map((row) => {
      const item = row as Record<string, unknown>
      const requestedRef = stringValue(item.service_ref)
      const service = services.find((entry) => entry.ref === requestedRef)
      return {
        service_id: service?.service_id || stringValue(item.service_id) || '',
        quantity: Math.max(1, Number(item.quantity) || 1),
      }
    })
  }

  return args
}

export function sanitizeHarryToolResultForModel(params: {
  toolName: string
  result: Record<string, unknown> | null
}): Record<string, unknown> | null {
  if (!params.result) return params.result
  if (params.toolName === 'list_my_upcoming_appointments') {
    return {
      ...params.result,
      upcoming: (Array.isArray(params.result.upcoming)
        ? params.result.upcoming
        : []
      ).map((row, index) => {
        const item = row as Record<string, unknown>
        const { appointment_id: _appointmentId, ...visible } = item
        return { appointment_ref: `appointment_${index + 1}`, ...visible }
      }),
    }
  }
  if (params.toolName === 'get_calendar_slots') {
    return {
      ...params.result,
      slots: (Array.isArray(params.result.slots)
        ? params.result.slots
        : []
      ).map((row, index) => {
        const item = row as Record<string, unknown>
        const {
          slot_token: _slotToken,
          assigned_staff_user_id: _staffId,
          ...visible
        } = item
        return { slot_ref: `slot_${index + 1}`, ...visible }
      }),
    }
  }
  if (params.toolName === 'search_service_catalog') {
    return {
      ...params.result,
      services: (Array.isArray(params.result.services)
        ? params.result.services
        : []
      ).map((row, index) => {
        const item = row as Record<string, unknown>
        const { id: _serviceId, ...visible } = item
        return { service_ref: `service_${index + 1}`, ...visible }
      }),
    }
  }
  return params.result
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
  const visibleCollected: Record<string, unknown> = {
    ...(state.collected_fields || {}),
  }
  if (state.collected_fields?.line_items) {
    visibleCollected.line_items = state.collected_fields.line_items.map(
      (item) => {
        const service = state.server_refs?.services?.find(
          (candidate) => candidate.service_id === item.service_id,
        )
        return {
          quantity: item.quantity,
          ...(service ? { service_ref: service.ref } : {}),
        }
      },
    )
  }
  const collected = JSON.stringify(visibleCollected)
  const appointments = (state.server_refs?.appointments || []).map(
    ({ appointment_id: _id, ...visible }) => visible,
  )
  const slots = (state.server_refs?.slots || []).map(
    ({ slot_token: _token, ...visible }) => visible,
  )
  const services = (state.server_refs?.services || []).map(
    ({ service_id: _id, ...visible }) => visible,
  )
  return `

DURABLE WORKFLOW STATE (authoritative across delayed replies):
- Intent: ${state.intent}
- Phase: ${state.phase}
- Collected fields: ${collected === '{}' ? 'none' : collected}
- Missing fields: ${state.missing_fields.join(', ') || 'none'}
- Appointment choices: ${appointments.length ? JSON.stringify(appointments) : 'none'}
- Slot choices: ${slots.length ? JSON.stringify(slots) : 'none'}
- Service choices: ${services.length ? JSON.stringify(services) : 'none'}
- Last verified action: ${state.last_action_name || 'none'}
- Last action status: ${state.last_action_status || 'none'}
- Unresolved action error: ${state.last_action_error || 'none'}
- Last customer message: ${state.last_customer_message || 'none'}

Rules:
- Continue this workflow even if the customer replied hours or days later.
- Database/tool results override conversational wording.
- Ask only for fields listed as missing. Never re-ask for collected fields.
- Use appointment_ref and slot_ref shown above. Raw UUIDs and signed slot tokens are server-owned and unavailable to you.
- When phase is ready_to_execute, call the appropriate action tool instead of asking the customer to repeat details.
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
