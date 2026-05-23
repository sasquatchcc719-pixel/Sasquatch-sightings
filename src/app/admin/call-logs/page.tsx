'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  PhoneCall,
  Phone,
  Voicemail,
  PhoneMissed,
  ShieldX,
  Loader2,
  RefreshCw,
  Download,
  Play,
  Square,
} from 'lucide-react'

interface CallLog {
  id: string
  call_sid: string
  caller_phone: string | null
  customer_name: string | null
  outcome: string
  duration_seconds: number | null
  recording_url: string | null
  transcription: string | null
  created_at: string
}

interface Summary {
  total: number
  answered: number
  voicemail: number
  missed: number
  blacklisted: number
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Unknown'
  const digits = phone.replace(/\D/g, '')
  const d =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDateTime(ts: string): { date: string; time: string } {
  const d = new Date(ts)
  return {
    date: d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Denver',
    }),
    time: d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Denver',
    }),
  }
}

const OUTCOME_CONFIG: Record<
  string,
  {
    label: string
    className: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  answered: {
    label: 'Answered',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    icon: Phone,
  },
  voicemail: {
    label: 'Voicemail',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    icon: Voicemail,
  },
  'no-answer': {
    label: 'Missed',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    icon: PhoneMissed,
  },
  blacklisted: {
    label: 'Blocked',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
    icon: ShieldX,
  },
  inbound: {
    label: 'Pending',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    icon: PhoneCall,
  },
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOME_CONFIG[outcome] ?? OUTCOME_CONFIG['inbound']
  const Icon = cfg.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  )
}

function VoicemailCell({
  recordingUrl,
  transcription,
}: {
  recordingUrl: string | null
  transcription: string | null
}) {
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  const proxyUrl = recordingUrl
    ? `/api/admin/call-logs/recording?url=${encodeURIComponent(recordingUrl)}`
    : null

  function toggle() {
    if (!proxyUrl) return
    if (!open) {
      setOpen(true)
      return
    }
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      void el.play()
    } else {
      el.pause()
    }
  }

  if (!recordingUrl && !transcription) {
    return <span className="text-muted-foreground text-xs">—</span>
  }

  return (
    <div className="space-y-1.5">
      {proxyUrl && (
        <>
          <button
            onClick={toggle}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/25"
          >
            {playing ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Play className="h-3 w-3 fill-current" />
            )}
            {playing ? 'Stop' : 'Play voicemail'}
          </button>
          {open && (
            <audio
              ref={audioRef}
              src={proxyUrl}
              controls
              autoPlay
              className="h-7 w-full max-w-[240px]"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          )}
        </>
      )}
      {transcription && (
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {transcription}
        </p>
      )}
    </div>
  )
}

const DAYS_OPTIONS = [7, 30, 90] as const

export default function CallLogsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [days, setDays] = useState<number>(30)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillResult, setBackfillResult] = useState<string | null>(null)

  async function load(d: number) {
    setLoading(true)
    setPageError(null)
    try {
      const res = await fetch(`/api/admin/call-logs?days=${d}`)
      const data = (await res.json()) as {
        calls?: CallLog[]
        summary?: Summary
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setCalls(data.calls ?? [])
      setSummary(data.summary ?? null)
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to load call logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(days)
  }, [days])

  async function handleBackfill() {
    setBackfilling(true)
    setBackfillResult(null)
    try {
      const res = await fetch('/api/admin/call-logs/backfill', {
        method: 'POST',
      })
      const data = (await res.json()) as {
        inserted?: number
        with_recordings?: number
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Backfill failed')
      const rec = data.with_recordings ?? 0
      setBackfillResult(
        `Imported ${data.inserted ?? 0} calls from Twilio history${rec > 0 ? ` · ${rec} with playable voicemails` : ''}`,
      )
      void load(days)
    } catch (e) {
      setBackfillResult(e instanceof Error ? e.message : 'Backfill failed')
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20">
            <PhoneCall className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Call Log</h1>
            <p className="text-muted-foreground text-sm">
              {summary
                ? `${summary.total} calls · ${summary.answered} answered · ${summary.voicemail} voicemail · ${summary.missed} missed`
                : 'Inbound call history'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Day range selector */}
          <div className="border-border flex overflow-hidden rounded-lg border text-sm">
            {DAYS_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 transition-colors ${days === d ? 'bg-emerald-500/20 text-emerald-400' : 'text-muted-foreground hover:bg-white/5'}`}
              >
                {d}d
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(days)}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleBackfill()}
            disabled={backfilling}
            className="gap-1.5"
            title="Import historical call data from Twilio (last 45 days)"
          >
            {backfilling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {backfilling ? 'Importing...' : 'Import History'}
          </Button>
        </div>
      </div>

      {/* Backfill result message */}
      {backfillResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-sm text-emerald-400">{backfillResult}</p>
        </Card>
      )}

      {/* Summary stats */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Answered
            </p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">
              {summary.answered}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {summary.total > 0
                ? Math.round((summary.answered / summary.total) * 100)
                : 0}
              % of calls
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Voicemail
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-400">
              {summary.voicemail}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              left a message
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Missed
            </p>
            <p className="mt-1 text-2xl font-bold text-slate-400">
              {summary.missed}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              hung up, no message
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Total
            </p>
            <p className="mt-1 text-2xl font-bold">{summary.total}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              last {days} days
            </p>
          </Card>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      )}

      {pageError && (
        <Card className="border-destructive/40 p-4">
          <p className="text-destructive text-sm">{pageError}</p>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !pageError && calls.length === 0 && (
        <Card className="p-8 text-center">
          <PhoneCall className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
          <p className="mb-1 font-medium">No calls recorded yet</p>
          <p className="text-muted-foreground mb-4 text-sm">
            New calls will appear here automatically. Use &quot;Import
            History&quot; to pull in past calls from Twilio.
          </p>
          <Button
            variant="outline"
            onClick={() => void handleBackfill()}
            disabled={backfilling}
            className="gap-2"
          >
            {backfilling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Import History from Twilio
          </Button>
        </Card>
      )}

      {/* Table */}
      {!loading && calls.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 bg-muted/30 border-b">
                  <th className="px-4 py-3 text-left font-medium">
                    Date / Time
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Caller</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Outcome</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-left font-medium">Voicemail</th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {calls.map((call) => {
                  const { date, time } = formatDateTime(call.created_at)
                  return (
                    <tr
                      key={call.id}
                      className="transition-colors hover:bg-white/5"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium">{date}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {time}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm">
                        {formatPhone(call.caller_phone)}
                      </td>
                      <td className="px-4 py-3">
                        {call.customer_name ? (
                          <span className="font-medium">
                            {call.customer_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Unknown
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <OutcomeBadge outcome={call.outcome} />
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="max-w-[280px] px-4 py-3">
                        <VoicemailCell
                          recordingUrl={call.recording_url}
                          transcription={call.transcription}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
