'use client'

/**
 * Unassigned Work Queue — the holding area feeding the calendar:
 *  1. Accepted estimates (customer said yes, not yet scheduled) — open the
 *     estimate to convert it onto the calendar.
 *  2. Maintenance side-work (triggered by fleet intervals) — knock out
 *     during schedule lulls; block the time on the calendar, then Done.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CalendarPlus,
  Check,
  ClipboardList,
  ExternalLink,
  Loader2,
  Wrench,
  X,
} from 'lucide-react'

type QueueEstimate = {
  id: string
  quoted_total: number | null
  created_at: string
  converted_appointment_id: string | null
  ops_customers: {
    full_name: string | null
    business_name: string | null
    phone: string | null
  } | null
  ops_service_addresses: { city: string | null } | null
}

type MTask = {
  id: string
  title: string
  status: string
  triggered_at: string
  meter_at_trigger: number | null
}

export default function WorkQueuePage() {
  const [estimates, setEstimates] = useState<QueueEstimate[]>([])
  const [tasks, setTasks] = useState<MTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [estRes, fleetRes] = await Promise.all([
      fetch('/api/admin/ops/estimates?status=accepted', { cache: 'no-store' }),
      fetch('/api/admin/fleet', { cache: 'no-store' }),
    ])
    const est = await estRes.json()
    const fleet = await fleetRes.json()
    setEstimates(
      ((est.estimates ?? []) as QueueEstimate[]).filter(
        (e) => !e.converted_appointment_id,
      ),
    )
    setTasks(
      ((fleet.tasks ?? []) as MTask[]).filter((t) => t.status === 'unassigned'),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const patchTask = async (id: string, status: 'completed' | 'dismissed') => {
    setBusyId(id)
    try {
      const res = await fetch('/api/admin/fleet', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'task', id, status }),
      })
      if (res.ok) await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ClipboardList className="h-5 w-5" /> Unassigned Work Queue
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Approved estimates waiting for a slot, and maintenance to slot into
          lulls. {estimates.length + tasks.length} item
          {estimates.length + tasks.length === 1 ? '' : 's'} waiting.
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold tracking-wide uppercase">
              Approved estimates ({estimates.length})
            </h2>
            {estimates.length === 0 ? (
              <Card className="text-muted-foreground p-4 text-sm">
                Nothing waiting — accepted estimates land here until scheduled.
              </Card>
            ) : (
              estimates.map((e) => {
                const name =
                  e.ops_customers?.business_name ||
                  e.ops_customers?.full_name ||
                  'Unknown customer'
                return (
                  <Card
                    key={e.id}
                    className="flex flex-wrap items-center gap-3 p-3 text-sm"
                  >
                    <Badge className="bg-green-600 text-white">Accepted</Badge>
                    <span className="font-medium">{name}</span>
                    {e.ops_service_addresses?.city ? (
                      <span className="text-muted-foreground">
                        {e.ops_service_addresses.city}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground ml-auto">
                      {e.quoted_total != null
                        ? `$${Number(e.quoted_total).toFixed(2)}`
                        : '—'}
                    </span>
                    <Link href={`/admin/operations/estimates/${e.id}`}>
                      <Button size="sm">
                        <CalendarPlus className="mr-1 h-4 w-4" /> Schedule
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </Link>
                  </Card>
                )
              })
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold tracking-wide uppercase">
              Maintenance side-work ({tasks.length})
            </h2>
            {tasks.length === 0 ? (
              <Card className="text-muted-foreground p-4 text-sm">
                No maintenance due. Tasks appear automatically when a fleet
                service interval is reached.
              </Card>
            ) : (
              tasks.map((t) => (
                <Card
                  key={t.id}
                  className="flex flex-wrap items-center gap-3 border-amber-500/40 p-3 text-sm"
                >
                  <Wrench className="h-4 w-4 text-amber-500" />
                  <span className="flex-1 font-medium">{t.title}</span>
                  <span className="text-muted-foreground text-xs">
                    due{' '}
                    {new Date(t.triggered_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  <Link href="/admin/operations?action=block">
                    <Button size="sm" variant="outline">
                      <CalendarPlus className="mr-1 h-4 w-4" /> Block time
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    disabled={busyId === t.id}
                    onClick={() => patchTask(t.id, 'completed')}
                  >
                    <Check className="mr-1 h-4 w-4" /> Done
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === t.id}
                    onClick={() => patchTask(t.id, 'dismissed')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Card>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}
