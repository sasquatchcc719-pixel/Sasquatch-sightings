'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  ShieldAlert,
  TerminalSquare,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/utils/tailwind'
import { loadScoutSession } from './actions'
import {
  bookingFingerprint,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTime,
  humanizeToolName,
  preview,
  safeJson,
  SELECTED_SESSION_PARAM,
  shortSessionId,
  summarizeUserAgent,
  transcriptRoleClass,
  type SessionDetail,
  type SessionSummary,
} from './shared'

type SessionBrowserProps = {
  summaries: SessionSummary[]
  /** Server-rendered detail for a ?session= deep link, so it opens instantly. */
  initialDetail: SessionDetail | null
}

/**
 * Session list where clicking a conversation opens it in an overlay.
 *
 * Deliberately NOT a set of <Link>s. Navigating re-rendered the page and
 * dropped the detail panel below the whole list, so reading one conversation
 * meant scrolling to the top, clicking, then scrolling back down. Open state is
 * local so the list keeps its scroll position, and the URL is updated with
 * history.replaceState (not the router) so links stay shareable without
 * triggering a navigation.
 */
export function SessionBrowser({
  summaries,
  initialDetail,
}: SessionBrowserProps) {
  const initialSessionId = initialDetail?.summary?.sessionId ?? null

  const [openSessionId, setOpenSessionId] = useState<string | null>(
    initialSessionId,
  )
  const [detail, setDetail] = useState<SessionDetail | null>(initialDetail)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Transcripts are immutable once logged, so a fetched session can be reopened
  // from memory. Seeded with the deep-linked session the server already sent.
  const [cache] = useState(
    () =>
      new Map<string, SessionDetail>(
        initialSessionId ? [[initialSessionId, initialDetail!]] : [],
      ),
  )
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const requestId = useRef(0)

  const syncUrl = useCallback((sessionId: string | null) => {
    const url = new URL(window.location.href)
    if (sessionId) url.searchParams.set(SELECTED_SESSION_PARAM, sessionId)
    else url.searchParams.delete(SELECTED_SESSION_PARAM)
    window.history.replaceState(null, '', url)
  }, [])

  const open = useCallback(
    async (sessionId: string) => {
      setOpenSessionId(sessionId)
      setError(null)
      syncUrl(sessionId)

      const cached = cache.get(sessionId)
      if (cached) {
        setDetail(cached)
        setLoading(false)
        return
      }

      setDetail(null)
      setLoading(true)
      const ticket = ++requestId.current
      const result = await loadScoutSession(sessionId)
      // A newer open() won the race — discard this response.
      if (ticket !== requestId.current) return

      if ('error' in result) {
        setError(result.error)
      } else {
        cache.set(sessionId, result)
        setDetail(result)
      }
      setLoading(false)
    },
    [cache, syncUrl],
  )

  const close = useCallback(() => {
    requestId.current += 1
    setOpenSessionId(null)
    setDetail(null)
    setError(null)
    setLoading(false)
    syncUrl(null)
  }, [syncUrl])

  // Esc to close, and lock background scroll so the list stays exactly where
  // it was when the overlay closes.
  useEffect(() => {
    if (!openSessionId) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [openSessionId, close])

  const summary =
    detail?.summary ??
    summaries.find((item) => item.sessionId === openSessionId) ??
    null

  return (
    <>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Sessions</h2>
          <span className="text-muted-foreground text-xs">
            {summaries.length} shown
          </span>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {summaries.map((item) => (
            <button
              key={item.sessionId}
              type="button"
              onClick={() => void open(item.sessionId)}
              aria-haspopup="dialog"
              className={cn(
                'block rounded-lg border p-3 text-left transition-colors',
                'border-white/10 bg-white/5 hover:border-emerald-400/60 hover:bg-white/10',
                'focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none',
                openSessionId === item.sessionId &&
                  'border-emerald-400/70 bg-emerald-500/10',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">
                      {shortSessionId(item.sessionId)}
                    </span>
                    {item.booked && (
                      <Badge className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/20">
                        Booked
                      </Badge>
                    )}
                    {item.phantomBlocked && (
                      <Badge variant="destructive">Phantom blocked</Badge>
                    )}
                    {item.failedToolCount > 0 && (
                      <Badge variant="destructive">
                        {item.failedToolCount} failed
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {summarizeUserAgent(item.userAgent)}
                    {item.origin ? ` · ${item.origin}` : ''}
                  </div>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {item.updatedLabel}
                </span>
              </div>
              <p className="mt-3 text-sm leading-snug">
                {preview(item.firstUserMessage || item.lastMessage)}
              </p>
              <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span>{item.messageCount} messages</span>
                <span>{item.toolCount} tools</span>
                {item.booked?.confirmationNumber && (
                  <span>{item.booked.confirmationNumber}</span>
                )}
                {item.booked?.total != null && (
                  <span>{formatMoney(item.booked.total)}</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {summaries.length === 0 && (
          <div className="text-muted-foreground rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
            No Scout sessions matched that search.
          </div>
        )}
      </section>

      {openSessionId && (
        <div
          className="fixed inset-0 z-[220] flex items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="scout-session-title"
            className="bg-card flex h-full w-full max-w-5xl flex-col border-white/10 shadow-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:border"
          >
            {/* Header stays put; only the body below scrolls. */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
              <div className="min-w-0">
                <h2
                  id="scout-session-title"
                  className="flex flex-wrap items-center gap-2 text-lg font-semibold"
                >
                  <span className="font-mono">
                    {shortSessionId(openSessionId)}
                  </span>
                  {summary?.booked && (
                    <Badge className="bg-emerald-500 text-slate-950 hover:bg-emerald-500">
                      Booked
                    </Badge>
                  )}
                  {summary?.phantomBlocked && (
                    <Badge variant="destructive">Phantom blocked</Badge>
                  )}
                  {(summary?.failedToolCount ?? 0) > 0 && (
                    <Badge variant="destructive">Review</Badge>
                  )}
                </h2>
                {summary && (
                  <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>Started {formatDateTime(summary.startedAt)}</span>
                    <span>Updated {formatDateTime(summary.updatedAt)}</span>
                    <span>{summarizeUserAgent(summary.userAgent)}</span>
                    {summary.origin && <span>{summary.origin}</span>}
                  </div>
                )}
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Close conversation"
                className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {loading && (
                <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversation...
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">
                  {error}
                </div>
              )}

              {!loading && !error && detail && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="min-w-0 space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <MessageSquare className="h-4 w-4 text-cyan-300" />
                      Transcript
                    </h3>
                    {detail.logs.map((log) => {
                      const suppressed =
                        typeof log.metadata?.suppressed_reply === 'string'
                          ? log.metadata.suppressed_reply
                          : null
                      return (
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
                          {suppressed && (
                            <div className="mt-3 rounded-md border border-red-400/40 bg-red-950/40 p-2">
                              <div className="flex items-center gap-2 text-xs font-semibold text-red-100">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Blocked claim (never sent to the customer)
                              </div>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-red-100/80">
                                {suppressed}
                              </p>
                            </div>
                          )}
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
                      )
                    })}
                    {detail.logs.length === 0 && (
                      <div className="text-muted-foreground rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
                        No messages were logged for this session.
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <TerminalSquare className="h-4 w-4 text-amber-300" />
                      Tool Calls
                    </h3>
                    {detail.tools.map((tool) => {
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
                    {detail.tools.length === 0 && (
                      <div className="text-muted-foreground rounded-lg border border-white/10 bg-white/5 p-4 text-sm">
                        No tool calls were logged for this session.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
