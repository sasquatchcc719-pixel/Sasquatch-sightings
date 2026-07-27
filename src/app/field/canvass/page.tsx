'use client'

/**
 * Canvassing — field view. One giant Start/Stop toggle for door-hanger
 * walks, live distance/time, and the shared coverage map so you can see
 * what's already been hit before picking a street.
 */

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Footprints, Loader2, MapPin } from 'lucide-react'
import { useCanvassTracker } from '@/hooks/useCanvassTracker'
import {
  CanvassCoverageMap,
  type CanvassSessionRow,
} from '@/components/canvass/CanvassCoverageMap'

const FILTERS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All time', days: 0 },
]

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function fmtMiles(m: number): string {
  return `${(m / 1609.344).toFixed(2)} mi`
}

function fmtWalkDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function fmtWalkTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtSpan(startIso: string, endIso: string | null): string {
  if (!endIso) return '—'
  const mins = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export default function CanvassPage() {
  const tracker = useCanvassTracker()
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState(30)
  const [refreshKey, setRefreshKey] = useState(0)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [sessions, setSessions] = useState<CanvassSessionRow[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)

  // Identity-stable so the map effect doesn't refetch on every render.
  const handleSessions = useCallback((rows: CanvassSessionRow[]) => {
    setSessions(rows)
  }, [])

  const toggle = async () => {
    setBusy(true)
    setLastResult(null)
    try {
      if (tracker.isTracking) {
        const result = await tracker.stop()
        if (result) {
          setLastResult(
            `Walk saved — ${fmtMiles(result.distanceM)}, ${result.pointCount} GPS points.`,
          )
          setRefreshKey((k) => k + 1)
        }
      } else {
        await tracker.start()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/field" className="text-slate-400 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Footprints className="h-5 w-5" /> Canvassing
          </h1>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`w-full rounded-2xl py-10 text-2xl font-bold shadow-lg transition-colors ${
            tracker.isTracking
              ? 'bg-red-600 hover:bg-red-500'
              : 'bg-green-600 hover:bg-green-500'
          } disabled:opacity-60`}
        >
          {busy ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          ) : tracker.isTracking ? (
            'Stop Canvassing'
          ) : (
            'Start Canvassing'
          )}
        </button>

        {tracker.isTracking ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-xs text-slate-400">Time</p>
              <p className="text-lg font-semibold">
                {fmtDuration(tracker.elapsedMs)}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-xs text-slate-400">Distance</p>
              <p className="text-lg font-semibold">
                {fmtMiles(tracker.distanceM)}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-xs text-slate-400">GPS</p>
              <p className="text-lg font-semibold">
                {tracker.accuracy != null
                  ? `±${Math.round(tracker.accuracy)}m`
                  : '—'}
              </p>
            </div>
          </div>
        ) : null}

        {tracker.error ? (
          <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-400">
            {tracker.error}
          </p>
        ) : null}
        {lastResult ? (
          <p className="rounded-lg bg-green-950/60 px-3 py-2 text-sm text-green-400">
            {lastResult}
          </p>
        ) : null}

        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
            <MapPin className="h-4 w-4" /> Coverage map
          </h2>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.days}
                type="button"
                onClick={() => setDays(f.days)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  days === f.days
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-slate-300'
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
          onSessions={handleSessions}
          focusSessionId={focusId}
          className="relative h-[55vh] w-full overflow-hidden rounded-xl"
        />
        <p className="text-xs text-slate-500">
          Shaded areas were already canvassed (label shows date + who walked
          it). Pick streets outside the shading — old faded neighborhoods are
          due for fresh door hangers.
        </p>

        <div className="flex items-center justify-between pt-1">
          <h2 className="text-sm font-semibold text-slate-300">Walk history</h2>
          {focusId ? (
            <button
              type="button"
              onClick={() => setFocusId(null)}
              className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-300"
            >
              Show all
            </button>
          ) : null}
        </div>

        {sessions.length === 0 ? (
          <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">
            No walks recorded in this range yet.
          </p>
        ) : (
          <div className="space-y-2 pb-4">
            {sessions.map((s) => {
              const active = focusId === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setFocusId(active ? null : s.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-white/40 bg-white/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <span
                    className="h-8 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {fmtWalkDate(s.started_at)}
                      <span className="text-slate-400">
                        {' '}
                        · {fmtWalkTime(s.started_at)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-400">
                      {s.user_name} · {fmtSpan(s.started_at, s.ended_at)} ·{' '}
                      {s.point_count} pts
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-200">
                    {fmtMiles(Number(s.distance_m ?? 0))}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
