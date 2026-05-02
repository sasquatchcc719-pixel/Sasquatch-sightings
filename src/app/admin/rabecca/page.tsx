'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type RabeccaToolLog = {
  id: string
  call_id: string | null
  caller_phone: string | null
  function_name: string
  request_args: Record<string, unknown>
  response_body: Record<string, unknown> | null
  success: boolean
  http_status: number | null
  error_message: string | null
  appointment_id: string | null
  created_at: string
}

type RabeccaCallLog = {
  id: string
  call_id: string | null
  caller_phone: string | null
  agent_name: string | null
  call_status: string | null
  duration_seconds: number | null
  transcript: string | null
  recording_url: string | null
  disconnection_reason: string | null
  sentiment: string | null
  call_successful: boolean | null
  created_at: string
}

const FUNCTION_OPTIONS = [
  'get_service_catalog',
  'get_calendar_slots',
  'create_booking',
  'create_estimate',
  'notify_admin',
]

function previewJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

export default function RabeccaDashboardPage() {
  const [logs, setLogs] = useState<RabeccaToolLog[]>([])
  const [calls, setCalls] = useState<RabeccaCallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [functionFilter, setFunctionFilter] = useState('')
  const [successFilter, setSuccessFilter] = useState('')

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('limit', '150')
      if (functionFilter) params.set('function_name', functionFilter)
      if (successFilter) params.set('success', successFilter)

      const response = await fetch(
        `/api/admin/rabecca/tool-logs?${params.toString()}`,
        { cache: 'no-store' },
      )
      const callsResponse = await fetch(
        '/api/admin/rabecca/call-logs?limit=25',
        {
          cache: 'no-store',
        },
      )
      const data = await response.json()
      const callsData = await callsResponse.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load Rabecca logs')
      }
      if (!callsResponse.ok) {
        throw new Error(callsData.error || 'Failed to load Rabecca calls')
      }
      setLogs(data.logs || [])
      setCalls(callsData.calls || [])
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load Rabecca logs',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [functionFilter, successFilter])

  const stats = useMemo(() => {
    return {
      total: logs.length,
      success: logs.filter((log) => log.success).length,
      failed: logs.filter((log) => !log.success).length,
      bookings: logs.filter((log) => log.function_name === 'create_booking')
        .length,
    }
  }, [logs])

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rabecca Voice Logs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every Retell tool call Rabecca makes, including args, result, and
            failures.
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Set Retell webhook URL to{' '}
            <code>
              https://sightings.sasquatchcarpet.com/api/retell/webhook
            </code>{' '}
            to capture transcripts and recordings.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadLogs()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-muted-foreground text-xs uppercase">
            Conversations
          </div>
          <div className="mt-1 text-2xl font-semibold">{calls.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-muted-foreground text-xs uppercase">Success</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">
            {stats.success}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-muted-foreground text-xs uppercase">Failed</div>
          <div className="mt-1 text-2xl font-semibold text-red-400">
            {stats.failed}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-muted-foreground text-xs uppercase">
            Booking Attempts
          </div>
          <div className="mt-1 text-2xl font-semibold">{stats.bookings}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={functionFilter}
            onChange={(event) => setFunctionFilter(event.target.value)}
          >
            <option value="">All functions</option>
            {FUNCTION_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
            value={successFilter}
            onChange={(event) => setSuccessFilter(event.target.value)}
          >
            <option value="">All outcomes</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFunctionFilter('')
              setSuccessFilter('')
            }}
          >
            Clear filters
          </Button>
        </div>
      </Card>

      {error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 text-sm">
          {error}
        </Card>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading Rabecca logs...</p>
      ) : logs.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">
          No Rabecca tool calls logged yet.
        </Card>
      ) : (
        <div className="space-y-6">
          {calls.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Recent Conversations</h2>
              {calls.map((call) => (
                <Card key={call.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {call.caller_phone || 'Unknown caller'}
                        </span>
                        {call.call_status ? (
                          <Badge variant="outline">{call.call_status}</Badge>
                        ) : null}
                        {call.call_successful !== null ? (
                          <Badge
                            variant={
                              call.call_successful ? 'outline' : 'destructive'
                            }
                          >
                            {call.call_successful
                              ? 'Successful'
                              : 'Needs review'}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {call.agent_name || 'Rabecca'}
                        {call.duration_seconds
                          ? ` · ${call.duration_seconds}s`
                          : ''}
                        {call.disconnection_reason
                          ? ` · ${call.disconnection_reason}`
                          : ''}
                      </div>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {new Date(call.created_at).toLocaleString()}
                    </span>
                  </div>
                  {call.recording_url ? (
                    <a
                      className="mt-3 inline-block text-sm text-cyan-300 hover:underline"
                      href={call.recording_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open recording
                    </a>
                  ) : null}
                  {call.transcript ? (
                    <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-black/30 p-3 text-xs whitespace-pre-wrap">
                      {call.transcript}
                    </pre>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : null}

          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Tool Calls</h2>
            {logs.map((log) => (
              <Card key={log.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {log.success ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 text-red-400" />
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{log.function_name}</span>
                        <Badge
                          variant={log.success ? 'outline' : 'destructive'}
                        >
                          {log.success ? 'Success' : 'Failed'}
                        </Badge>
                        {log.http_status ? (
                          <Badge variant="outline">
                            HTTP {log.http_status}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {log.caller_phone || 'Unknown caller'}
                        {log.call_id ? ` · ${log.call_id}` : ''}
                        {log.appointment_id
                          ? ` · appointment ${log.appointment_id}`
                          : ''}
                      </div>
                    </div>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>

                {log.error_message ? (
                  <p className="mt-3 text-sm text-red-300">
                    {log.error_message}
                  </p>
                ) : null}

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs">
                      Request Args
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-md bg-black/30 p-3 text-xs whitespace-pre-wrap">
                      {previewJson(log.request_args)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-muted-foreground mb-1 text-xs">
                      Response
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-md bg-black/30 p-3 text-xs whitespace-pre-wrap">
                      {previewJson(log.response_body)}
                    </pre>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
