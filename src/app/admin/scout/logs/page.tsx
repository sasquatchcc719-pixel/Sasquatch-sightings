import Link from 'next/link'
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageSquare,
  Search,
  TerminalSquare,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/supabase/server'
import { cn } from '@/utils/tailwind'

type PageProps = {
  searchParams: Promise<{ q?: string; session?: string }>
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

type ChatLogRow = {
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

type ToolCallRow = {
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

type SessionSummary = {
  sessionId: string
  startedAt: string
  updatedAt: string
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
}

type BookingFingerprint = {
  confirmationNumber: string | null
  appointmentDate: string | null
  startTime: string | null
  status: string | null
  total: number | null
}

const LOG_LIMIT = 900
const TOOL_LIMIT = 1200

function asRecord(value: unknown): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, JsonValue>
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatRelative(value: string): string {
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

function formatDuration(ms: number | null): string {
  if (ms == null) return 'n/a'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatMoney(value: number | null): string {
  if (value == null) return 'n/a'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

function shortSessionId(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}...` : sessionId
}

function preview(value: string | null, max = 150): string {
  const compact = (value || '').replace(/\s+/g, ' ').trim()
  if (!compact) return 'No message content'
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact
}

function summarizeUserAgent(userAgent: string | null): string {
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

function humanizeToolName(toolName: string): string {
  return toolName
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function bookingFingerprint(tool: ToolCallRow): BookingFingerprint | null {
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

function safeJson(value: unknown): string {
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

function buildSessionSummaries(
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

      return {
        sessionId,
        startedAt: first?.created_at || '',
        updatedAt: last?.created_at || '',
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
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function sessionMatchesQuery(
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

function transcriptRoleClass(role: ChatLogRow['role']): string {
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

export default async function ScoutLogsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const query = (params.q || '').trim()
  const requestedSession = (params.session || '').trim()
  const supabase = createAdminClient()

  const { data: logRows, error: logsError } = await supabase
    .from('ai_chat_logs')
    .select(
      'id, session_id, from_identity, role, channel, content, model, tokens_prompt, tokens_completion, latency_ms, metadata, created_at',
    )
    .eq('agent', 'scout')
    .order('created_at', { ascending: false })
    .limit(LOG_LIMIT)

  const recentLogs = ((logRows || []) as ChatLogRow[]).reverse()
  const sessionIds = Array.from(
    new Set(recentLogs.map((log) => log.session_id).filter(Boolean)),
  )

  const { data: toolRows, error: toolsError } = sessionIds.length
    ? await supabase
        .from('ai_tool_calls')
        .select(
          'id, session_id, tool_name, args, result, success, error, duration_ms, created_at',
        )
        .eq('agent', 'scout')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false })
        .limit(TOOL_LIMIT)
    : { data: [], error: null }

  const recentTools = ((toolRows || []) as ToolCallRow[]).reverse()
  const summaries = buildSessionSummaries(recentLogs, recentTools)
  const visibleSummaries = summaries.filter((summary) =>
    sessionMatchesQuery(summary, recentLogs, recentTools, query),
  )
  const selectedSessionId =
    requestedSession ||
    visibleSummaries[0]?.sessionId ||
    summaries[0]?.sessionId

  const [{ data: selectedLogRows }, { data: selectedToolRows }] =
    selectedSessionId
      ? await Promise.all([
          supabase
            .from('ai_chat_logs')
            .select(
              'id, session_id, from_identity, role, channel, content, model, tokens_prompt, tokens_completion, latency_ms, metadata, created_at',
            )
            .eq('agent', 'scout')
            .eq('session_id', selectedSessionId)
            .order('created_at', { ascending: true }),
          supabase
            .from('ai_tool_calls')
            .select(
              'id, session_id, tool_name, args, result, success, error, duration_ms, created_at',
            )
            .eq('agent', 'scout')
            .eq('session_id', selectedSessionId)
            .order('created_at', { ascending: true }),
        ])
      : [{ data: [] }, { data: [] }]

  const selectedLogs = (selectedLogRows || []) as ChatLogRow[]
  const selectedTools = (selectedToolRows || []) as ToolCallRow[]
  const selectedSummary =
    buildSessionSummaries(selectedLogs, selectedTools)[0] ||
    summaries.find((summary) => summary.sessionId === selectedSessionId)

  const bookedCount = summaries.filter((summary) => summary.booked).length
  const failedToolSessions = summaries.filter(
    (summary) => summary.failedToolCount > 0,
  ).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-emerald-300" />
            <h1 className="text-3xl font-bold">Scout Logs</h1>
          </div>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Website chat transcripts, tool calls, booking confirmations, and
            Scout runtime fingerprints from the latest logged sessions.
          </p>
        </div>
        <Link
          href="/admin/operations/settings"
          className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium hover:bg-white/15"
        >
          Agent Settings
          <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      {(logsError || toolsError) && (
        <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">
          {logsError?.message || toolsError?.message || 'Failed to load logs.'}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="bg-white/5">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4 text-cyan-300" />
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{summaries.length}</div>
            <div className="text-muted-foreground text-xs">
              From latest {recentLogs.length} log rows
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Booked
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{bookedCount}</div>
            <div className="text-muted-foreground text-xs">
              Sessions with successful book_new_job
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4 text-amber-300" />
              Tool Calls
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{recentTools.length}</div>
            <div className="text-muted-foreground text-xs">
              Catalog, slots, booking, alerts
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white/5">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-red-300" />
              Needs Review
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold">{failedToolSessions}</div>
            <div className="text-muted-foreground text-xs">
              Sessions with failed tool calls
            </div>
          </CardContent>
        </Card>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        action="/admin/scout/logs"
      >
        <label className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search transcripts, tools, confirmations, or sessions"
            className="border-input bg-background h-10 w-full rounded-md border px-9 text-sm"
          />
        </label>
        <button className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
          Search
        </button>
        {query && (
          <Link
            href="/admin/scout/logs"
            className="inline-flex items-center justify-center rounded-md border border-white/15 px-4 py-2 text-sm hover:bg-white/10"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Sessions</h2>
            <span className="text-muted-foreground text-xs">
              {visibleSummaries.length} shown
            </span>
          </div>
          <div className="max-h-[72vh] space-y-2 overflow-y-auto pr-1">
            {visibleSummaries.map((summary) => {
              const isActive = summary.sessionId === selectedSessionId
              const href = `/admin/scout/logs?session=${encodeURIComponent(summary.sessionId)}${
                query ? `&q=${encodeURIComponent(query)}` : ''
              }`
              return (
                <Link
                  key={summary.sessionId}
                  href={href}
                  className={cn(
                    'block rounded-lg border p-3 transition-colors',
                    isActive
                      ? 'border-emerald-400/70 bg-emerald-500/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">
                          {shortSessionId(summary.sessionId)}
                        </span>
                        {summary.booked && (
                          <Badge className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/20">
                            Booked
                          </Badge>
                        )}
                        {summary.failedToolCount > 0 && (
                          <Badge variant="destructive">
                            {summary.failedToolCount} failed
                          </Badge>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {summarizeUserAgent(summary.userAgent)}
                        {summary.origin ? ` · ${summary.origin}` : ''}
                      </div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatRelative(summary.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-snug">
                    {preview(summary.firstUserMessage || summary.lastMessage)}
                  </p>
                  <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>{summary.messageCount} messages</span>
                    <span>{summary.toolCount} tools</span>
                    {summary.booked?.confirmationNumber && (
                      <span>{summary.booked.confirmationNumber}</span>
                    )}
                    {summary.booked?.total != null && (
                      <span>{formatMoney(summary.booked.total)}</span>
                    )}
                  </div>
                </Link>
              )
            })}
            {visibleSummaries.length === 0 && (
              <div className="text-muted-foreground rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
                No Scout sessions matched that search.
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {selectedSummary ? (
            <>
              <Card className="bg-white/5">
                <CardHeader className="p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                        <span className="font-mono">
                          {shortSessionId(selectedSummary.sessionId)}
                        </span>
                        {selectedSummary.booked && (
                          <Badge className="bg-emerald-500 text-slate-950 hover:bg-emerald-500">
                            Booked
                          </Badge>
                        )}
                        {selectedSummary.failedToolCount > 0 && (
                          <Badge variant="destructive">Review</Badge>
                        )}
                      </CardTitle>
                      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span>
                          Started {formatDateTime(selectedSummary.startedAt)}
                        </span>
                        <span>
                          Updated {formatDateTime(selectedSummary.updatedAt)}
                        </span>
                        <span>
                          {summarizeUserAgent(selectedSummary.userAgent)}
                        </span>
                        {selectedSummary.origin && (
                          <span>{selectedSummary.origin}</span>
                        )}
                      </div>
                    </div>
                    {selectedSummary.booked && (
                      <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm">
                        <div className="font-semibold text-emerald-100">
                          {selectedSummary.booked.confirmationNumber ||
                            'Booked job'}
                        </div>
                        <div className="text-muted-foreground mt-1">
                          {selectedSummary.booked.appointmentDate || 'No date'}{' '}
                          at {selectedSummary.booked.startTime || 'n/a'} ·{' '}
                          {formatMoney(selectedSummary.booked.total)}
                        </div>
                      </div>
                    )}
                  </div>
                </CardHeader>
              </Card>

              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
                <Card className="min-w-0 bg-white/5">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquare className="h-4 w-4 text-cyan-300" />
                      Transcript
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    {selectedLogs.map((log) => (
                      <article
                        key={log.id}
                        className={cn(
                          'rounded-lg border p-3',
                          transcriptRoleClass(log.role),
                        )}
                      >
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">
                              {log.role}
                            </Badge>
                            {log.model && (
                              <span className="text-muted-foreground text-xs">
                                {log.model}
                              </span>
                            )}
                          </div>
                          <span className="text-muted-foreground text-xs">
                            {formatTime(log.created_at)}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {log.content || '(empty)'}
                        </p>
                        {(log.latency_ms ||
                          log.tokens_prompt ||
                          log.tokens_completion) && (
                          <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {log.latency_ms != null && (
                              <span>{formatDuration(log.latency_ms)}</span>
                            )}
                            {log.tokens_prompt != null && (
                              <span>{log.tokens_prompt} prompt tokens</span>
                            )}
                            {log.tokens_completion != null && (
                              <span>
                                {log.tokens_completion} completion tokens
                              </span>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  </CardContent>
                </Card>

                <Card className="min-w-0 bg-white/5">
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TerminalSquare className="h-4 w-4 text-amber-300" />
                      Tool Calls
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    {selectedTools.map((tool) => {
                      const booked = bookingFingerprint(tool)
                      return (
                        <article
                          key={tool.id}
                          className={cn(
                            'rounded-lg border p-3',
                            tool.success
                              ? 'border-white/10 bg-white/5'
                              : 'border-red-400/40 bg-red-500/10',
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">
                                  {humanizeToolName(tool.tool_name)}
                                </span>
                                {tool.success ? (
                                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                                ) : (
                                  <AlertTriangle className="h-4 w-4 text-red-300" />
                                )}
                              </div>
                              <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                                <span>{formatTime(tool.created_at)}</span>
                                <span>{formatDuration(tool.duration_ms)}</span>
                              </div>
                            </div>
                            <Badge
                              variant={tool.success ? 'outline' : 'destructive'}
                            >
                              {tool.success ? 'ok' : 'failed'}
                            </Badge>
                          </div>

                          {tool.error && (
                            <p className="mt-3 rounded-md bg-red-950/40 p-2 text-xs text-red-100">
                              {tool.error}
                            </p>
                          )}

                          {booked && (
                            <div className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-500/10 p-2 text-xs">
                              <div className="font-semibold text-emerald-100">
                                {booked.confirmationNumber}
                              </div>
                              <div className="text-muted-foreground mt-1">
                                {booked.appointmentDate} at {booked.startTime} ·{' '}
                                {formatMoney(booked.total)}
                              </div>
                            </div>
                          )}

                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs font-medium text-cyan-100">
                              Args and result
                            </summary>
                            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-slate-950/70 p-3 text-xs leading-relaxed">
                              {safeJson({
                                args: tool.args,
                                result: tool.result,
                              })}
                            </pre>
                          </details>
                        </article>
                      )
                    })}
                    {selectedTools.length === 0 && (
                      <div className="text-muted-foreground rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
                        No tool calls were logged for this session.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <Card className="bg-white/5">
              <CardContent className="flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
                <CalendarClock className="text-muted-foreground h-8 w-8" />
                <h2 className="text-lg font-semibold">No Scout logs yet</h2>
                <p className="text-muted-foreground max-w-md text-sm">
                  Scout web chats will appear here after the website chat API
                  records messages in ai_chat_logs.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Clock className="h-3 w-3" />
        Times shown in Mountain Time. Raw slot tokens are shortened in the
        expanded tool JSON.
      </div>
    </div>
  )
}
