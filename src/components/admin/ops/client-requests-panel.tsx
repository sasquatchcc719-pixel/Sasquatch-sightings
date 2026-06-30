'use client'

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Loader2, Inbox } from 'lucide-react'

type ClientRequest = {
  id: string
  request_type: string
  status: string
  message: string | null
  admin_notes: string | null
  created_at: string
  appointment_id: string | null
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
  skip_visit: 'Skipped visit',
  other: 'Other',
}

export function ClientRequestsPanel() {
  const [requests, setRequests] = useState<ClientRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  async function load() {
    try {
      const res = await fetch('/api/admin/ops/client-requests')
      const d = (await res.json()) as { requests?: ClientRequest[] }
      setRequests(d.requests || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function resolve(id: string, status: string) {
    setBusyId(id)
    try {
      await fetch(`/api/admin/ops/client-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_notes: notes[id] || undefined }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending').slice(0, 10)

  // Hide the panel entirely when there's nothing to show (keeps the page clean).
  if (!loading && requests.length === 0) return null

  function customerName(r: ClientRequest) {
    return (
      r.ops_customers?.business_name || r.ops_customers?.full_name || 'Client'
    )
  }

  return (
    <Card className="mb-6 border-amber-500/30 bg-amber-500/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-4 w-4 text-amber-500" />
        <h2 className="text-lg font-semibold">Client requests</h2>
        {pending.length > 0 && (
          <Badge className="bg-amber-500 text-black">
            {pending.length} pending
          </Badge>
        )}
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <div className="space-y-3">
          {pending.map((r) => (
            <div
              key={r.id}
              className="bg-background/60 rounded-lg border border-amber-500/30 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {TYPE_LABEL[r.request_type] ?? r.request_type}
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
                  onClick={() => resolve(r.id, 'approved')}
                >
                  {busyId === r.id ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Approve
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
              <p className="text-muted-foreground mt-2 text-xs">
                Approving just records your decision — apply the actual change
                with the tools below.
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
                      {TYPE_LABEL[r.request_type] ?? r.request_type}
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
