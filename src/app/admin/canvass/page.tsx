'use client'

/**
 * Canvassing coverage — admin view. Shared map plus the session ledger:
 * per-walk stats, per-user totals, and delete for accidental/bad sessions
 * (left tracking on during a drive, phone in a pocket at home, etc.).
 */

import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Footprints, Trash2 } from 'lucide-react'
import {
  CanvassCoverageMap,
  type CanvassSessionRow,
} from '@/components/canvass/CanvassCoverageMap'

const FILTERS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time', days: 0 },
]

function fmtMiles(m: number | null): string {
  return m == null ? '—' : `${(m / 1609.344).toFixed(2)} mi`
}

export default function AdminCanvassPage() {
  const [days, setDays] = useState(30)
  const [sessions, setSessions] = useState<CanvassSessionRow[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  const totals = useMemo(() => {
    const byUser = new Map<string, { miles: number; walks: number }>()
    for (const s of sessions) {
      const t = byUser.get(s.user_name) ?? { miles: 0, walks: 0 }
      t.miles += (s.distance_m ?? 0) / 1609.344
      t.walks += 1
      byUser.set(s.user_name, t)
    }
    return [...byUser.entries()]
  }, [sessions])

  const deleteSession = async (id: string) => {
    if (
      !confirm(
        'Delete this canvassing session? The route is removed from the coverage map permanently.',
      )
    )
      return
    setBusyId(id)
    try {
      const res = await fetch(`/api/field/canvass/coverage?sessionId=${id}`, {
        method: 'DELETE',
      })
      if (res.ok) setRefreshKey((k) => k + 1)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Footprints className="h-5 w-5" /> Canvassing Coverage
        </h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.days}
              type="button"
              onClick={() => setDays(f.days)}
              className={`rounded-full px-3 py-1 text-xs ${
                days === f.days
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <CanvassCoverageMap
        days={days}
        refreshKey={refreshKey}
        onSessions={setSessions}
        className="relative h-[55vh] w-full overflow-hidden rounded-xl"
      />

      {totals.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {totals.map(([name, t]) => (
            <Card key={name} className="px-4 py-2 text-sm">
              <span className="font-medium">{name}</span>{' '}
              <span className="text-muted-foreground">
                — {t.walks} walk{t.walks === 1 ? '' : 's'}, {t.miles.toFixed(1)}{' '}
                mi
              </span>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        {sessions.map((s) => (
          <Card key={s.id} className="flex items-center gap-3 p-3 text-sm">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="font-medium">{s.user_name}</span>
            <span className="text-muted-foreground">
              {new Date(s.started_at).toLocaleString('en-US', {
                timeZone: 'America/Denver',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <span className="text-muted-foreground ml-auto">
              {fmtMiles(s.distance_m)} · {s.point_count} pts
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500"
              disabled={busyId === s.id}
              onClick={() => deleteSession(s.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
        {sessions.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-center text-sm">
            No canvassing sessions in this window yet. Walks appear here as soon
            as someone hits Start Canvassing in the field view.
          </Card>
        ) : null}
      </div>
    </div>
  )
}
