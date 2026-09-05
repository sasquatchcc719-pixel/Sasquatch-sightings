'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Inbox } from 'lucide-react'
import {
  useCommercialTestRequests,
  type TestRequest,
} from './use-commercial-test-requests'

type ClientRequest = {
  id: string
  customer_id: string
  request_type: string
  status: string
  message: string | null
  admin_notes: string | null
  created_at: string
  appointment_id: string | null
  details: Record<string, unknown>
  ops_customers: {
    business_name: string | null
    full_name: string | null
  } | null
  ops_appointments: { appointment_date: string; start_time: string } | null
}

const TYPE_LABEL: Record<string, string> = {
  reschedule: 'Reschedule',
  add_visit: 'Add visit',
  scope_change: 'Scope change',
  skip_visit: 'Cancellation / skipped visit',
  other: 'Other',
}

export function ClientRequestsPanel() {
  const [requests, setRequests] = useState<ClientRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const {
    records: testRecords,
    error: testError,
    resolve: resolveTest,
    clear: clearTests,
  } = useCommercialTestRequests()

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ops/client-requests', {
        cache: 'no-store',
      })
      const d = (await res.json()) as { requests?: ClientRequest[] }
      if (!res.ok) throw new Error('Unable to load client requests')
      setRequests(d.requests || [])
      setError('')
    } catch {
      setError('Unable to load client requests. Refresh to try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id.startsWith('client-request-')) {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }
  }, [requests])

  async function resolve(id: string, status: string) {
    setBusyId(id)
    try {
      const response = await fetch(`/api/admin/ops/client-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_notes: notes[id] || undefined }),
      })
      if (!response.ok) throw new Error('Unable to update request')
      await load()
    } catch {
      setError('Request was not updated. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests.filter(
    (r) => r.status === 'pending' || r.status === 'approved',
  )
  const resolved = requests
    .filter((r) => r.status !== 'pending' && r.status !== 'approved')
    .slice(0, 10)

  function customerName(r: ClientRequest) {
    return (
      r.ops_customers?.business_name || r.ops_customers?.full_name || 'Client'
    )
  }

  return (
    <Card
      id="client-requests"
      className="mb-6 scroll-mt-6 border-amber-500/30 bg-amber-500/5 p-5"
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-amber-500" />
        <h2 className="text-lg font-semibold">Client requests</h2>
        {pending.length > 0 && (
          <Badge className="bg-amber-500 text-black">
            {pending.length} need action
          </Badge>
        )}
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh requests
        </Button>
      </div>
      <p className="text-muted-foreground mb-3 text-sm">
        Customer requests for extra work, schedule changes, and agreement
        revisions appear here. Real submissions trigger a Telegram alert. Staff
        test-drive records are browser-only and never enter production.
      </p>
      {testError && (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {testError}
        </p>
      )}

      {testRecords.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200/25 bg-amber-200/5 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-amber-200 text-slate-950">Browser tests</Badge>
            <span className="text-xs text-amber-50/75">
              Visible only in this browser; never sent to the production API.
            </span>
            <button
              className="ml-auto text-xs text-amber-100 underline"
              type="button"
              onClick={() => clearTests()}
            >
              Clear tests
            </button>
          </div>
          <div className="space-y-2">
            {testRecords.map((record) => (
              <TestRequestRow
                key={record.id}
                record={record}
                onResolve={resolveTest}
              />
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {requests.length === 0 && !error && (
            <p className="text-sm">No customer requests yet.</p>
          )}
          {pending.map((r) => (
            <div
              key={r.id}
              id={`client-request-${r.id}`}
              className="bg-background/60 scroll-mt-6 rounded-lg border border-amber-500/30 p-3 target:ring-2 target:ring-cyan-400"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {r.details.agreement_id
                    ? 'Agreement changes'
                    : (TYPE_LABEL[r.request_type] ?? r.request_type)}
                </Badge>
                <span className="text-sm font-medium">{customerName(r)}</span>
                {r.ops_appointments && (
                  <span className="text-muted-foreground text-xs">
                    visit{' '}
                    {new Date(
                      `${r.ops_appointments.appointment_date}T00:00:00`,
                    ).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto text-xs">
                  {new Date(r.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {r.message && <p className="mt-2 text-sm">{r.message}</p>}
              <Link
                className="mt-2 inline-block text-sm text-cyan-400"
                href={`/admin/operations/commercial/${r.customer_id}`}
              >
                Open customer account →
              </Link>
              {Object.entries(r.details || {})
                .filter(
                  ([key, v]) =>
                    key !== 'agreement_id' && typeof v === 'string' && v,
                )
                .map(([key, value]) => (
                  <p key={key} className="text-muted-foreground mt-1 text-sm">
                    {key.replaceAll('_', ' ')}: {String(value)}
                  </p>
                ))}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Optional reply to client…"
                  value={notes[r.id] ?? ''}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, [r.id]: e.target.value }))
                  }
                  className="h-8 max-w-xs text-sm"
                />
                <Button
                  size="sm"
                  disabled={busyId === r.id}
                  onClick={() =>
                    resolve(r.id, r.status === 'approved' ? 'done' : 'approved')
                  }
                >
                  {busyId === r.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {r.status === 'approved' ? 'Mark applied' : 'Approve request'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r.id, 'declined')}
                >
                  Decline
                </Button>
              </div>
              {r.appointment_id && (
                <Link
                  className="mt-2 inline-block text-sm text-cyan-400"
                  href={`/admin/operations/appointments/${r.appointment_id}`}
                >
                  Open visit to apply the change →
                </Link>
              )}
              {typeof r.details.agreement_id === 'string' && (
                <Link
                  className="mt-2 inline-block text-sm text-cyan-400"
                  href={`/admin/operations/commercial/${r.customer_id}`}
                >
                  Open commercial account to revise agreement →
                </Link>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                {r.details.agreement_id
                  ? 'Approval records your decision; it does not change the contract. Withdraw the unsigned version, create and publish the revision, then mark this request applied. The customer reviews and signs the updated version.'
                  : r.status === 'approved'
                    ? 'Approved, awaiting the actual change. Update the visit or service plan, then mark this request applied.'
                    : 'Approval records your decision. Apply the schedule change with Operations, then mark it applied.'}
              </p>
            </div>
          ))}

          {resolved.length > 0 && (
            <div className="border-border/60 mt-2 border-t pt-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase">
                Recent activity
              </p>
              <div className="space-y-1.5">
                {resolved.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-sm">
                    <Badge variant="outline" className="text-xs">
                      {r.details.agreement_id
                        ? 'Agreement changes'
                        : (TYPE_LABEL[r.request_type] ?? r.request_type)}
                    </Badge>
                    <span className="text-muted-foreground">
                      {customerName(r)}
                    </span>
                    {r.message && (
                      <span className="text-muted-foreground truncate">
                        — {r.message}
                      </span>
                    )}
                    <span
                      className={`ml-auto text-xs ${
                        r.status === 'declined'
                          ? 'text-red-400'
                          : r.status === 'approved'
                            ? 'text-emerald-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function TestRequestRow({
  record,
  onResolve,
}: {
  record: TestRequest
  onResolve: (id: string, status: TestRequest['status'], notes?: string) => void
}) {
  return (
    <div className="rounded-lg border border-amber-200/20 bg-slate-950/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className="border-amber-200/40 text-amber-100">
          TEST · {record.request_type.replaceAll('_', ' ')}
        </Badge>
        <span className="font-medium">{record.business_name}</span>
        <span className="text-muted-foreground ml-auto text-xs">
          {record.status}
        </span>
      </div>
      <p className="mt-2 text-sm">{record.message}</p>
      {Object.entries(record.details)
        .filter(([, value]) => value)
        .map(([key, value]) => (
          <p key={key} className="text-muted-foreground mt-1 text-xs">
            {key.replaceAll('_', ' ')}: {value}
          </p>
        ))}
      {record.admin_notes && (
        <p className="mt-1 text-xs text-emerald-300">
          Reply: {record.admin_notes}
        </p>
      )}
      {record.status === 'pending' && (
        <button
          className="mt-2 rounded-md border border-amber-200/30 px-2 py-1 text-xs text-amber-100"
          type="button"
          onClick={() =>
            onResolve(
              record.id,
              'approved',
              'Approved in the staff test drive. Awaiting scheduling.',
            )
          }
        >
          Approve test request
        </button>
      )}
      {record.status === 'approved' && (
        <p className="mt-1 text-xs text-amber-50/70">
          Approved — awaiting scheduling.
        </p>
      )}
    </div>
  )
}
