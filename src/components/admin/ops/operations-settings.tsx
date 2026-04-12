'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2, MessageSquare, Play, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { QuickBooksStatus } from '@/components/admin/ops/quickbooks-status'

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

type CommunicationTemplate = {
  template_key: string
  channel: 'sms' | 'email'
  label: string
  is_enabled: boolean
}

type TemplatesResponse = {
  templates: CommunicationTemplate[]
}

export function OperationsSettings() {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<QueueStatusResponse | null>(null)
  const [templates, setTemplates] = useState<CommunicationTemplate[]>([])
  const [lastRunMessage, setLastRunMessage] = useState<string | null>(null)

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const [queueResponse, templatesResponse] = await Promise.all([
        fetch('/api/admin/ops/communications/queue', {
          cache: 'no-store',
        }),
        fetch('/api/admin/ops/communications/templates', {
          cache: 'no-store',
        }),
      ])

      const [queueResult, templatesResult] = (await Promise.all([
        queueResponse.json(),
        templatesResponse.json(),
      ])) as [
        QueueStatusResponse & { error?: string },
        TemplatesResponse & { error?: string },
      ]

      if (!queueResponse.ok) {
        throw new Error(queueResult.error || 'Failed to load settings')
      }
      if (!templatesResponse.ok) {
        throw new Error(templatesResult.error || 'Failed to load templates')
      }
      setStatus(queueResult)
      setTemplates(templatesResult.templates || [])
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

  const templateByKey = new Map(
    templates.map((template) => [template.template_key, template]),
  )
  const jobScheduledSmsEnabled =
    templateByKey.get('job_scheduled_sms')?.is_enabled || false
  const jobScheduledEmailEnabled =
    templateByKey.get('job_scheduled_email')?.is_enabled || false
  const onMyWaySmsEnabled =
    templateByKey.get('on_my_way_sms')?.is_enabled || false
  const jobFinishedSmsEnabled =
    templateByKey.get('job_finished_sms')?.is_enabled || false
  const jobFinishedEmailEnabled =
    templateByKey.get('job_finished_email')?.is_enabled || false

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

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <h3 className="text-lg font-semibold">QuickBooks Integration</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect to QuickBooks Online to sync customers and invoices
          automatically. Use the toggle to pause syncing without disconnecting.
        </p>
        <div className="mt-4">
          <QuickBooksStatus />
        </div>
      </Card>

      <Card className="border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">
              Lifecycle Messaging Status
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">
              This controls whether customer messages go out automatically
              during job lifecycle events. If a template is OFF, that message is
              skipped.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/operations/communications">
              <MessageSquare className="mr-2 h-4 w-4" />
              Open Communications
            </Link>
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On Job Create (Scheduled)</div>
              <div className="text-muted-foreground text-sm">
                Triggered when a dispatcher creates a job in Operations.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={jobScheduledSmsEnabled ? 'default' : 'outline'}>
                SMS {jobScheduledSmsEnabled ? 'ON' : 'OFF'}
              </Badge>
              <Badge variant={jobScheduledEmailEnabled ? 'default' : 'outline'}>
                Email {jobScheduledEmailEnabled ? 'ON' : 'OFF'}
              </Badge>
            </div>
          </div>

          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On My Way</div>
              <div className="text-muted-foreground text-sm">
                Triggered when job status is changed to <code>on_my_way</code>.
              </div>
            </div>
            <Badge variant={onMyWaySmsEnabled ? 'default' : 'outline'}>
              SMS {onMyWaySmsEnabled ? 'ON' : 'OFF'}
            </Badge>
          </div>

          <div className="border-border/60 bg-background/70 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div>
              <div className="font-medium">On Job Complete</div>
              <div className="text-muted-foreground text-sm">
                Triggered when job status is changed to <code>completed</code>.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={jobFinishedSmsEnabled ? 'default' : 'outline'}>
                SMS {jobFinishedSmsEnabled ? 'ON' : 'OFF'}
              </Badge>
              <Badge variant={jobFinishedEmailEnabled ? 'default' : 'outline'}>
                Email {jobFinishedEmailEnabled ? 'ON' : 'OFF'}
              </Badge>
            </div>
          </div>
        </div>
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
