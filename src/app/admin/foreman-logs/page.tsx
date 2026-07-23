'use client'

/**
 * Foreman diagnostic logs — review what the field AI was asked and what it
 * recommended, so bad advice gets caught and protocols get tuned.
 */

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronUp, FlaskConical, Loader2 } from 'lucide-react'

type LogRow = {
  id: string
  user_name: string
  transcript: string | null
  reply: string | null
  created_at: string
}

export default function ForemanLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/foreman-logs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setLogs(data.logs ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FlaskConical className="h-5 w-5" /> Foreman Logs
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every field diagnosis the AI assistant has given. Spot bad advice here
          and tell Claude what to tune.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : logs.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No diagnoses yet — logs appear as soon as someone uses Foreman in the
          field portal.
        </Card>
      ) : (
        logs.map((log) => {
          const expanded = expandedId === log.id
          const firstLine =
            log.transcript?.split('\n')[0]?.replace(/^user: /, '') ?? '(empty)'
          return (
            <Card key={log.id} className="p-4">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left"
                onClick={() => setExpandedId(expanded ? null : log.id)}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {firstLine}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {log.user_name} ·{' '}
                  {new Date(log.created_at).toLocaleString('en-US', {
                    timeZone: 'America/Denver',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                )}
              </button>
              {expanded ? (
                <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-semibold uppercase">
                      Conversation
                    </p>
                    <p className="whitespace-pre-wrap">{log.transcript}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs font-semibold uppercase">
                      Foreman&apos;s answer
                    </p>
                    <p className="whitespace-pre-wrap">
                      {log.reply ?? '(no reply recorded)'}
                    </p>
                  </div>
                </div>
              ) : null}
            </Card>
          )
        })
      )}
    </div>
  )
}
