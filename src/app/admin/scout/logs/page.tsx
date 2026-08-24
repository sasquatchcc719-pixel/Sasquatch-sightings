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
  Wrench,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createAdminClient } from '@/supabase/server'
import { SessionBrowser } from './session-browser'
import { loadScoutSession } from './actions'
import {
  buildSessionSummaries,
  sessionMatchesQuery,
  type ChatLogRow,
  type SessionDetail,
  type ToolCallRow,
} from './shared'

type PageProps = {
  searchParams: Promise<{ q?: string; session?: string }>
}

const LOG_LIMIT = 900
const TOOL_LIMIT = 1200

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

  // Only a ?session= deep link (e.g. from a Telegram alert) pre-opens a
  // conversation. Landing on the page plain shows just the list.
  let initialDetail: SessionDetail | null = null
  if (requestedSession) {
    const result = await loadScoutSession(requestedSession)
    if (!('error' in result)) initialDetail = result
  }

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
            Scout runtime fingerprints from the latest logged sessions. Tap any
            conversation to read it.
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

      {summaries.length === 0 ? (
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
      ) : (
        <SessionBrowser
          summaries={visibleSummaries}
          initialDetail={initialDetail}
        />
      )}

      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Clock className="h-3 w-3" />
        Times shown in Mountain Time. Raw slot tokens are shortened in the
        expanded tool JSON.
      </div>
    </div>
  )
}
