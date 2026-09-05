'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Inbox } from 'lucide-react'

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

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/ops/client-requests', {
        cache: 'no-store',
      })
      const d = (await res.json()) as { requests?: ClientRequest[] }
      if (!res.ok) throw new Error('Unable to load agreement notes')
      setRequests(d.requests || [])
      setError('')
    } catch {
      setError('Unable to load agreement notes. Refresh to try again.')
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
      if (!response.ok) throw new Error('Unable to update note')
      await load()
    } catch {
      setError('The note was not updated. Please try again.')
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
        <h2 className="text-lg font-semibold">Agreement notes</h2>
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
          Refresh notes
        </Button>
      </div>
      <p className="text-muted-foreground mb-3 text-sm">
        Notes customers send while reviewing an agreement appear here and
        trigger a Telegram alert. Historical requests remain visible below.
      </p>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {requests.length === 0 && !error && (
            <p className="text-sm">No agreement notes yet.</p>
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
                    ? 'Agreement note'
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
                  placeholder="Optional internal response note…"
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
                  {r.details.agreement_id
                    ? r.status === 'approved'
                      ? 'Mark resolved'
                      : 'Acknowledge note'
                    : r.status === 'approved'
                      ? 'Mark applied'
                      : 'Approve request'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r.id, 'declined')}
                >
                  {r.details.agreement_id ? 'No change needed' : 'Decline'}
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
                  ? 'Acknowledging records that you reviewed the note; it does not change the agreement. If needed, withdraw the unsigned version, publish the revision, and then mark the note resolved.'
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
                        ? 'Agreement note'
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
