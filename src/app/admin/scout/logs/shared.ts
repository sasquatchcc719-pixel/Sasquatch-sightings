/**
 * Types and pure formatters shared by the Scout logs page (server) and the
 * session browser / transcript modal (client).
 *
 * Everything here must stay side-effect free and serialisable so it can cross
 * the server/client boundary. Note that relative timestamps are precomputed on
 * the server into `updatedLabel` rather than derived from Date.now() in the
 * browser — otherwise the client render disagrees with the server render
 * whenever a minute ticks over between the two.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type ChatLogRow = {
  id: string
  session_id: string
  from_identity: string
  role: 'user' | 'assistant' | 'system' | 'owner' | 'tool'
  channel: string
  content: string | null
  model: string | null
  tokens_prompt: number | null
  tokens_completion: number | null
  latency_ms: number | null
  metadata: Record<string, JsonValue> | null
  created_at: string
}

export type ToolCallRow = {
  id: string
  session_id: string
  tool_name: string
  args: Record<string, JsonValue> | null
  result: Record<string, JsonValue> | null
  success: boolean
  error: string | null
  duration_ms: number | null
  created_at: string
}

export type BookingFingerprint = {
  confirmationNumber: string | null
  appointmentDate: string | null
  startTime: string | null
  status: string | null
  total: number | null
}

export type SessionSummary = {
  sessionId: string
  startedAt: string
  updatedAt: string
  /** Precomputed on the server to keep client hydration stable. */
  updatedLabel: string
  fromIdentity: string
  origin: string | null
  userAgent: string | null
  firstUserMessage: string | null
  lastMessage: string | null
  messageCount: number
  userCount: number
  assistantCount: number
  toolCount: number
  failedToolCount: number
  booked: BookingFingerprint | null
  /** Scout claimed a booking the server had to retract. */
  phantomBlocked: boolean
}

/** Full detail for one session, as returned by the transcript action. */
export type SessionDetail = {
  summary: SessionSummary | null
  logs: ChatLogRow[]
  tools: ToolCallRow[]
}

export const SELECTED_SESSION_PARAM = 'session'

export function asRecord(value: unknown): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, JsonValue>
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatDateTime(value: string): string {
  if (!value) return 'n/a'
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatRelative(value: string): string {
  if (!value) return 'n/a'
  const ms = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.floor(ms / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDateTime(value)
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return 'n/a'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function formatMoney(value: number | null): string {
  if (value == null) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId
}

export function preview(value: string | null, max = 150): string {
  const compact = (value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return 'No message content'
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact
}

export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown browser'
  const browser = userAgent.includes('CriOS')
    ? 'Chrome iOS'
    : userAgent.includes('Chrome')
      ? 'Chrome'
      : userAgent.includes('Safari')
        ? 'Safari'
        : userAgent.includes('Firefox')
          ? 'Firefox'
          : 'Browser'
  const device = userAgent.includes('Android')
    ? 'Android'
    : userAgent.includes('iPhone')
      ? 'iPhone'
      : userAgent.includes('iPad')
        ? 'iPad'
        : userAgent.includes('Macintosh')
          ? 'Mac'
          : userAgent.includes('Windows')
            ? 'Windows'
            : 'Device'
  return `${device} ${browser}`
}

export function humanizeToolName(toolName: string): string {
  return toolName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function bookingFingerprint(
  tool: ToolCallRow,
): BookingFingerprint | null {
  if (tool.tool_name !== 'book_new_job') return null
  const result = asRecord(tool.result)
  if (!tool.success || result?.success !== true) return null
  return {
    confirmationNumber: asString(result.confirmation_number),
    appointmentDate: asString(result.appointment_date),
    startTime: asString(result.start_time),
    status: asString(result.status),
    total: asNumber(result.total),
  }
}

export function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (key, item) => {
      if (key === 'slot_token' && typeof item === 'string') {
        return `${item.slice(0, 14)}...`
      }
      return item
    },
    2,
  )
}

export function buildSessionSummaries(
  logs: ChatLogRow[],
  tools: ToolCallRow[],
): SessionSummary[] {
  const bySession = new Map<string, ChatLogRow[]>()
  for (const log of logs) {
    const existing = bySession.get(log.session_id) || []
    existing.push(log)
    bySession.set(log.session_id, existing)
  }

  const toolsBySession = new Map<string, ToolCallRow[]>()
  for (const tool of tools) {
    const existing = toolsBySession.get(tool.session_id) || []
    existing.push(tool)
    toolsBySession.set(tool.session_id, existing)
  }

  return Array.from(bySession.entries())
    .map(([sessionId, sessionLogs]) => {
      const orderedLogs = [...sessionLogs].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      )
      const sessionTools = toolsBySession.get(sessionId) || []
      const first = orderedLogs[0]
      const last = orderedLogs[orderedLogs.length - 1]
      const firstUser = orderedLogs.find((log) => log.role === 'user')
      const lastContent = [...orderedLogs]
        .reverse()
        .find((log) => log.content)?.content
      const metadata = first?.metadata || {}
      const booked = sessionTools.map(bookingFingerprint).find(Boolean) || null
      const updatedAt = last?.created_at || ''

      return {
        sessionId,
        startedAt: first?.created_at || '',
        updatedAt,
        updatedLabel: formatRelative(updatedAt),
        fromIdentity: first?.from_identity || '',
        origin: asString(metadata.origin),
        userAgent: asString(metadata.user_agent),
        firstUserMessage: firstUser?.content || null,
        lastMessage: lastContent || null,
        messageCount: orderedLogs.length,
        userCount: orderedLogs.filter((log) => log.role === 'user').length,
        assistantCount: orderedLogs.filter((log) => log.role === 'assistant')
          .length,
        toolCount: sessionTools.length,
        failedToolCount: sessionTools.filter((tool) => !tool.success).length,
        booked,
        phantomBlocked: orderedLogs.some(
          (log) => log.metadata?.phantom_booking_blocked === true,
        ),
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function sessionMatchesQuery(
  summary: SessionSummary,
  logs: ChatLogRow[],
  tools: ToolCallRow[],
  query: string,
): boolean {
  if (!query) return true
  const needle = query.toLowerCase()
  const haystack = [
    summary.sessionId,
    summary.origin,
    summary.userAgent,
    summary.firstUserMessage,
    summary.lastMessage,
    summary.booked?.confirmationNumber,
    ...logs
      .filter((log) => log.session_id === summary.sessionId)
      .map((log) => log.content),
    ...tools
      .filter((tool) => tool.session_id === summary.sessionId)
      .map(
        (tool) =>
          `${tool.tool_name} ${safeJson(tool.args)} ${safeJson(tool.result)}`,
      ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export function transcriptRoleClass(role: ChatLogRow['role']): string {
  switch (role) {
    case 'user':
      return 'border-cyan-400/40 bg-cyan-500/10'
    case 'assistant':
      return 'border-emerald-400/40 bg-emerald-500/10'
    case 'system':
      return 'border-amber-400/40 bg-amber-500/10'
    default:
      return 'border-slate-400/30 bg-slate-500/10'
  }
}
