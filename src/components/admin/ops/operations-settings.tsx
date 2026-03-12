'use client'

import { useEffect, useState } from 'react'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type QueueStats = {
  pending: number
  due_now: number
  failed: number
  sent_last_24h: number
}

type QueueStatusResponse = {
  stats: QueueStats
  cron_provider: string
  recommended_schedule: string
}

export function OperationsSettings() {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<QueueStatusResponse | null>(null)
  const [lastRunMessage, setLastRunMessage] = useState<string | null>(null)

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/ops/communications/queue', {
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to load settings')
      }
      setStatus(result)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load settings',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const runNow = async () => {
    setRunning(true)
    setError(null)
    setLastRunMessage(null)
    try {
      const response = await fetch('/api/admin/ops/communications/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to process queue')
      }
      setLastRunMessage(
        `Processed ${result.result.processed}, sent ${result.result.sent}, failed ${result.result.failed}.`,
      )
      await loadStatus()
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : 'Failed to process queue',
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h2 className="text-2xl font-semibold">Operations Settings</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Delayed communications are handled with Vercel Cron plus the queue in
          Supabase. Immediate lifecycle messages send instantly and do not wait
          for cron.
        </p>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {lastRunMessage ? (
        <Card className="border-border/60 bg-card/80 p-4 text-sm shadow-sm backdrop-blur">
          {lastRunMessage}
        </Card>
      ) : null}

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Communications Queue</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Monitor delayed follow-up emails and trigger processing manually.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void loadStatus()}
              disabled={loading || running}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button onClick={() => void runNow()} disabled={running || loading}>
              {running ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Due Now
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Pending
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.pending ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Due now
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.due_now ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Failed
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.failed ?? 0}
            </div>
          </Card>
          <Card className="border-border/60 bg-background/70 p-4">
            <div className="text-muted-foreground text-xs uppercase">
              Sent (24h)
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {status?.stats.sent_last_24h ?? 0}
            </div>
          </Card>
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">Cron Configuration</h3>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Provider:</span>
            <Badge variant="outline">{status?.cron_provider || 'vercel'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Schedule:</span>
            <code>{status?.recommended_schedule || '*/15 * * * *'}</code>
          </div>
          <div className="text-muted-foreground">
            Route: <code>/api/cron/ops-communications</code>
          </div>
        </div>
      </Card>
    </div>
  )
}
