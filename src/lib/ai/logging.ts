/**
 * Unified logging for AI agents (Harry, Scout, and anything we add later).
 *
 * Every user turn, every assistant turn, every tool call — one row.
 * Writes go through the admin client so RLS never blocks us.
 *
 * Failures are swallowed (console.error) so a logging hiccup never kills a
 * real customer reply. Losing an audit record is bad; losing a reply is worse.
 */

import { createAdminClient } from '@/supabase/server'

export type AiAgent = 'harry' | 'scout' | 'harry_owner'
export type AiChannel = 'sms' | 'web' | 'admin'
export type AiRole = 'user' | 'assistant' | 'system' | 'owner' | 'tool'

export type LogChatMessageInput = {
  agent: AiAgent
  channel: AiChannel
  sessionId: string
  fromIdentity: string
  role: AiRole
  content: string | null
  model?: string
  tokensPrompt?: number
  tokensCompletion?: number
  latencyMs?: number
  metadata?: Record<string, unknown>
}

export type LogToolCallInput = {
  agent: AiAgent
  sessionId: string
  assistantMessageId?: string | null
  toolName: string
  args: Record<string, unknown>
  result?: Record<string, unknown> | unknown[] | null
  success: boolean
  error?: string | null
  durationMs?: number
}

/**
 * Log a single chat message. Returns the inserted row id (useful for
 * linking subsequent tool calls to this assistant turn) or null on failure.
 */
export async function logChatMessage(
  input: LogChatMessageInput,
): Promise<string | null> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ai_chat_logs')
      .insert({
        agent: input.agent,
        channel: input.channel,
        session_id: input.sessionId,
        from_identity: input.fromIdentity,
        role: input.role,
        content: input.content ?? null,
        model: input.model ?? null,
        tokens_prompt: input.tokensPrompt ?? null,
        tokens_completion: input.tokensCompletion ?? null,
        latency_ms: input.latencyMs ?? null,
        metadata: input.metadata ?? {},
      })
      .select('id')
      .single()

    if (error) {
      console.error('[ai-logging] logChatMessage failed:', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error('[ai-logging] logChatMessage threw:', err)
    return null
  }
}

/**
 * Log a single tool invocation. Args get captured even on failure so we can
 * debug what Harry tried to do.
 */
export async function logToolCall(input: LogToolCallInput): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('ai_tool_calls').insert({
      agent: input.agent,
      session_id: input.sessionId,
      assistant_message_id: input.assistantMessageId ?? null,
      tool_name: input.toolName,
      args: input.args,
      result: input.result ?? null,
      success: input.success,
      error: input.error ?? null,
      duration_ms: input.durationMs ?? null,
    })
    if (error) {
      console.error('[ai-logging] logToolCall failed:', error.message)
    }
  } catch (err) {
    console.error('[ai-logging] logToolCall threw:', err)
  }
}

/**
 * Count recent messages from a given identity (used for abuse rate-limiting
 * that survives serverless cold starts, unlike the in-memory approach).
 *
 * Returns the number of inbound user messages from this identity within
 * the last `windowSeconds`.
 */
export async function countRecentUserMessages(params: {
  agent?: AiAgent
  fromIdentity: string
  windowSeconds: number
}): Promise<number> {
  try {
    const supabase = createAdminClient()
    const since = new Date(
      Date.now() - params.windowSeconds * 1000,
    ).toISOString()
    let q = supabase
      .from('ai_chat_logs')
      .select('id', { head: true, count: 'exact' })
      .eq('from_identity', params.fromIdentity)
      .eq('role', 'user')
      .gte('created_at', since)
    if (params.agent) q = q.eq('agent', params.agent)
    const { count, error } = await q
    if (error) {
      console.error(
        '[ai-logging] countRecentUserMessages failed:',
        error.message,
      )
      return 0
    }
    return count ?? 0
  } catch (err) {
    console.error('[ai-logging] countRecentUserMessages threw:', err)
    return 0
  }
}
