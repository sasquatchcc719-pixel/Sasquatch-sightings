'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Battery, Radio, Satellite, Truck, Navigation } from 'lucide-react'
import {
  FleetTracker,
  TrackerHistoryPoint,
  trackerStatus,
} from '@/lib/fleet-tracking'
import {
  mountainDateKey,
  mountainLocalDateTimeToIso,
} from '@/lib/ops/timesheet-pay'

const TrackerMap = dynamic(() => import('./fleet-tracker-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[55vh] items-center justify-center text-slate-400">
      Loading vehicle map…
    </div>
  ),
})

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Sign in with an owner, admin, or dispatcher account.'
        : 'Unable to refresh tracking. Retrying…',
    )
  return response.json()
}

function timeLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Not received yet'
}

export default function FleetTrackerDashboard({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const [selectedId, setSelectedId] = useState('')
  const [day, setDay] = useState(() => mountainDateKey(new Date()))
  const [focusRequest, setFocusRequest] = useState(0)
  const live = useQuery({
    queryKey: ['fleet-trackers'],
    queryFn: () =>
      fetchJson<{ trackers: FleetTracker[] }>('/api/admin/fleet/trackers'),
    refetchInterval: 2000,
  })
  const trackers = live.data?.trackers ?? []
  const selected =
    trackers.find((tracker) => tracker.id === selectedId) ?? trackers[0]
  const nextDay = new Date(`${day}T12:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  const start = mountainLocalDateTimeToIso(day, '00:00')
  const end = mountainLocalDateTimeToIso(
    nextDay.toISOString().slice(0, 10),
    '00:00',
  )
  const history = useQuery({
    queryKey: ['fleet-tracker-history', selected?.id, day],
    queryFn: () =>
      fetchJson<{ points: TrackerHistoryPoint[] }>(
        `/api/admin/fleet/trackers/${selected!.id}/history?${new URLSearchParams({ start: start!, end: end! })}`,
      ),
    enabled: !!selected && !!start && !!end,
    refetchInterval: day === mountainDateKey(new Date()) ? 15_000 : false,
  })
  const connected = trackers.filter(
    (tracker) =>
      tracker.last_seen_at &&
      tracker.enabled &&
      now - Date.parse(tracker.last_seen_at) <= 45_000,
  ).length
  const earliestDay = mountainDateKey(new Date(now - 29 * 86400_000))

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-[0.2em] text-emerald-300 uppercase">
              Sasquatch operations
            </p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Truck className="h-6 w-6 text-emerald-400" /> Live Dispatch
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Vehicle locations and 30 days of movement history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/operations"
              className="rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/10"
            >
              Calendar
            </Link>
            <Link
              href="/admin/fleet"
              className="rounded-xl border border-white/15 px-4 py-3 text-sm hover:bg-white/10"
            >
              Fleet &amp; maintenance
            </Link>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-emerald-200">
          <Radio className="mr-2 inline h-4 w-4" />
          {connected} connected
        </span>
        <span className="rounded-full border border-white/10 px-4 py-2 text-slate-300">
          {trackers.length} registered
        </span>
        <span className="self-center text-xs text-slate-400">
          Refreshes every 2 seconds while this page is open
        </span>
      </div>
      {live.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200"
        >
          {live.error.message} Existing positions may be out of date.
        </p>
      )}
      <div
        className={
          embedded ? 'space-y-4' : 'grid gap-4 lg:grid-cols-[300px_1fr]'
        }
      >
        <div
          className={embedded ? 'flex gap-3 overflow-x-auto pb-1' : 'space-y-3'}
        >
          {live.isPending && (
            <p className="p-4 text-slate-400">Loading trackers…</p>
          )}
          {!live.isPending && !trackers.length && (
            <p className="rounded-2xl border border-white/10 p-5 text-slate-300">
              No trackers registered yet.
            </p>
          )}
          {trackers.map((tracker) => {
            const status = trackerStatus(tracker, now)
            const online = ![
              'Offline',
              'Disabled',
              'Waiting for first connection',
            ].includes(status)
            return (
              <button
                key={tracker.id}
                onClick={() => {
                  setSelectedId(tracker.id)
                  setFocusRequest((value) => value + 1)
                }}
                aria-pressed={selected?.id === tracker.id}
                className={`${embedded ? 'min-w-48 shrink-0 p-3' : 'w-full p-4'} rounded-2xl border text-left transition-colors ${selected?.id === tracker.id ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-white/10 bg-slate-950/40 hover:bg-white/5'}`}
              >
                <span className="flex items-center justify-between gap-2 font-semibold text-white">
                  <span className="break-words">{tracker.name}</span>
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-slate-500'}`}
                  />
                </span>
                <span className="mt-2 block text-sm text-slate-300">
                  {status}
                </span>
                {!embedded && (
                  <>
                    <span className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>
                        <Battery className="mr-1 inline h-4 w-4" />
                        {tracker.battery_v === null
                          ? 'Battery unavailable'
                          : `${tracker.battery_v.toFixed(2)} V`}
                      </span>
                      <span>
                        <Satellite className="mr-1 inline h-4 w-4" />
                        {tracker.satellites === null
                          ? 'No satellite count'
                          : `${tracker.satellites} satellites`}
                      </span>
                    </span>
                    <span className="mt-3 block text-xs leading-5 text-slate-400">
                      Last contact: {timeLabel(tracker.last_seen_at)}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        <div className="min-w-0 space-y-3">
          <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-slate-950">
            <TrackerMap
              now={now}
              historyKey={`${selected?.id ?? ''}:${day}`}
              trackers={trackers}
              selectedId={selected?.id ?? ''}
              points={history.data?.points ?? []}
              focusRequest={focusRequest}
              onSelect={setSelectedId}
            />
            {selected && selected.latitude === null && (
              <div className="pointer-events-none absolute right-3 bottom-3 left-3 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-sm text-slate-200">
                <Satellite className="mr-2 inline h-4 w-4 text-amber-300" />
                Waiting for the first GPS fix. Take the antenna outdoors with an
                internet connection.
              </div>
            )}
          </div>
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-4">
              <div className="text-sm">
                <p className="font-medium text-slate-200">{selected.name}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Last GPS fix: {timeLabel(selected.gps_at)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold tabular-nums">
                  {trackerStatus(selected, now) === 'Moving' ||
                  trackerStatus(selected, now) === 'Parked'
                    ? `${Math.round((selected.speed_mps ?? 0) * 2.23694)} mph`
                    : '— mph'}
                </span>
                <button
                  onClick={() => setFocusRequest((value) => value + 1)}
                  disabled={selected.latitude === null}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-white/15 px-3 text-sm disabled:opacity-40"
                >
                  <Navigation className="h-4 w-4" />
                  Locate
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
            <label className="text-sm text-slate-200">
              Movement history (Mountain Time)
              <input
                aria-label="History date"
                type="date"
                value={day}
                min={earliestDay}
                max={mountainDateKey(new Date())}
                onChange={(event) => {
                  if (event.target.value) setDay(event.target.value)
                }}
                className="mt-2 block min-h-11 rounded-lg border border-white/20 bg-slate-900 px-3 text-white [color-scheme:dark]"
              />
            </label>
            <p className="max-w-xs text-xs leading-5 text-slate-400">
              {history.error
                ? 'History could not refresh. Try again shortly.'
                : history.isFetching
                  ? 'Refreshing history…'
                  : history.data?.points.length
                    ? `${history.data.points.length.toLocaleString()} GPS samples shown`
                    : 'No recorded locations for this day.'}
              <br />
              Gaps over 90 seconds are left disconnected.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
