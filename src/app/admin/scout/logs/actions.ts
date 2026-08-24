'use server'

import { createAdminClient } from '@/supabase/server'
import { getUserWithRole, hasRoleAccess } from '@/lib/auth'
import {
  buildSessionSummaries,
  type ChatLogRow,
  type SessionDetail,
  type ToolCallRow,
} from './shared'

const LOG_COLUMNS =
  'id, session_id, from_identity, role, channel, content, model, tokens_prompt, tokens_completion, latency_ms, metadata, created_at'
const TOOL_COLUMNS =
  'id, session_id, tool_name, args, result, success, error, duration_ms, created_at'

/**
 * Load one Scout session's full transcript and tool calls.
 *
 * Server Actions are reachable independently of the /admin layout, so the role
 * check has to happen here rather than relying on the page that calls it.
 * Transcripts contain customer names, phone numbers and addresses.
 */
export async function loadScoutSession(
  sessionId: string,
): Promise<SessionDetail | { error: string }> {
  const { user, role } = await getUserWithRole()
  if (
    !user ||
    !hasRoleAccess(role, ['owner', 'dispatcher', 'marketing', 'admin'])
  ) {
    return { error: 'Not authorized' }
  }

  const trimmed = (sessionId || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(trimmed)) {
    return { error: 'Invalid session id' }
  }

  const supabase = createAdminClient()
  const [
    { data: logRows, error: logError },
    { data: toolRows, error: toolError },
  ] = await Promise.all([
    supabase
      .from('ai_chat_logs')
      .select(LOG_COLUMNS)
      .eq('agent', 'scout')
      .eq('session_id', trimmed)
      .order('created_at', { ascending: true }),
    supabase
      .from('ai_tool_calls')
      .select(TOOL_COLUMNS)
      .eq('agent', 'scout')
      .eq('session_id', trimmed)
      .order('created_at', { ascending: true }),
  ])

  if (logError || toolError) {
    console.error('[scout logs] session load failed:', logError || toolError)
    return { error: 'Could not load that conversation. Try again.' }
  }

  const logs = (logRows || []) as ChatLogRow[]
  const tools = (toolRows || []) as ToolCallRow[]

  return {
    summary: buildSessionSummaries(logs, tools)[0] ?? null,
    logs,
    tools,
  }
}
