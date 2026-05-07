import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  RangerCommandMessage,
  RangerCommandThread,
  RangerPendingAction,
} from './types'

export async function markRangerTelegramUpdateProcessed(params: {
  supabase: SupabaseClient
  updateId: number | undefined
  chatId: number | string | null
  userId: number | string | null
  metadata?: Record<string, unknown>
}) {
  if (params.updateId == null) return true

  const { error } = await params.supabase
    .from('ranger_telegram_updates')
    .insert({
      update_id: params.updateId,
      telegram_chat_id: params.chatId == null ? null : String(params.chatId),
      telegram_user_id: params.userId == null ? null : String(params.userId),
      metadata: params.metadata || {},
    })

  if (!error) return true
  if (error.code === '23505') return false
  throw error
}

export async function getOrCreateRangerCommandThread(params: {
  supabase: SupabaseClient
  chatId: number | string
  userId?: number | string | null
}) {
  const telegramChatId = String(params.chatId)
  const telegramUserId = params.userId == null ? null : String(params.userId)
  const { data: existing, error: existingError } = await params.supabase
    .from('ranger_command_threads')
    .select('*')
    .eq('telegram_chat_id', telegramChatId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing) return existing as RangerCommandThread

  const { data: created, error: createError } = await params.supabase
    .from('ranger_command_threads')
    .insert({
      telegram_chat_id: telegramChatId,
      telegram_user_id: telegramUserId,
      metadata: { created_by: 'ranger_telegram' },
    })
    .select('*')
    .single()

  if (createError) throw createError
  return created as RangerCommandThread
}

export async function appendRangerCommandMessage(params: {
  supabase: SupabaseClient
  threadId: string
  role: RangerCommandMessage['role']
  body: string
  applicantId?: string | null
  metadata?: Record<string, unknown>
}) {
  const { data, error } = await params.supabase
    .from('ranger_command_messages')
    .insert({
      thread_id: params.threadId,
      applicant_id: params.applicantId || null,
      role: params.role,
      body: params.body,
      metadata: params.metadata || {},
    })
    .select('*')
    .single()

  if (error) throw error
  return data as RangerCommandMessage
}

export async function loadRangerThreadMemory(params: {
  supabase: SupabaseClient
  threadId: string
  limit?: number
}) {
  const { data, error } = await params.supabase
    .from('ranger_command_messages')
    .select('*')
    .eq('thread_id', params.threadId)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 16)

  if (error) throw error
  return ((data || []) as RangerCommandMessage[]).reverse()
}

export async function updateRangerThreadState(params: {
  supabase: SupabaseClient
  threadId: string
  lastApplicantId?: string | null
  summary?: string | null
  metadata?: Record<string, unknown>
}) {
  const patch: Record<string, unknown> = {}
  if ('lastApplicantId' in params) {
    patch.last_applicant_id = params.lastApplicantId || null
  }
  if ('summary' in params) patch.summary = params.summary || null
  if (params.metadata) patch.metadata = params.metadata
  if (Object.keys(patch).length === 0) return

  const { error } = await params.supabase
    .from('ranger_command_threads')
    .update(patch)
    .eq('id', params.threadId)

  if (error) throw error
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashRangerActionPayload(payload: Record<string, unknown>) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex')
}

export async function createRangerPendingAction(params: {
  supabase: SupabaseClient
  threadId?: string | null
  applicantId?: string | null
  actionType: string
  payload: Record<string, unknown>
  requestedBy: string
}) {
  const payloadHash = hashRangerActionPayload(params.payload)
  const { data, error } = await params.supabase
    .from('ranger_pending_actions')
    .insert({
      thread_id: params.threadId || null,
      applicant_id: params.applicantId || null,
      action_type: params.actionType,
      payload: params.payload,
      payload_hash: payloadHash,
      requested_by: params.requestedBy,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as RangerPendingAction
}
