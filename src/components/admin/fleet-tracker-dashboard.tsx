'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Navigation, Truck } from 'lucide-react'
import {
  FleetTracker,
  TrackerHistoryPoint,
  trackerStatus,
} from '@/lib/fleet-tracking'
import {
  dispatchDayBounds,
  driveIntervals,
  isDispatchDay,
  type DailyDispatch,
} from '@/lib/ops/daily-dispatch'
import { mountainDateKey } from '@/lib/ops/timesheet-pay'

const TrackerMap = dynamic(() => import('./fleet-tracker-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[55vh] items-center justify-center text-slate-400">
      Loading map…
    </div>
  ),
})
const NO_POINTS: TrackerHistoryPoint[] = []

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Sign in with an owner, admin, or dispatcher account.'
        : 'Unable to refresh this view. Try again shortly.',
    )
  return response.json()
}
function clock(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
  })
}
function jobTime(value: string) {
  return new Date(`2000-01-01T${value}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function FleetTrackerDashboard({
  embedded = false,
  day: calendarDay,
  staffFilter = null,
}: {
  embedded?: boolean
  day?: string
  staffFilter?: string | null
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const [chosenDay, setChosenDay] = useState(() => mountainDateKey(new Date()))
  const day = calendarDay ?? chosenDay
  const today = mountainDateKey(new Date(now))
  const isToday = day === today,
    future = day > today
  const bounds = dispatchDayBounds(day)
  const [selectedId, setSelectedId] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [selectedDrive, setSelectedDrive] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const schedule = useQuery({
    queryKey: ['dispatch-day', day],
    queryFn: () =>
      fetchJson<DailyDispatch>(
        `/api/admin/fleet/daily-map?${new URLSearchParams({ date: day })}`,
      ),
    enabled: !!bounds,
    refetchInterval: 60000,
  })
  const jobs = useMemo(
    () =>
      (schedule.data?.jobs ?? []).filter(
        (job) =>
          !staffFilter ||
          job.staffId === staffFilter ||
          (!job.staffId && staffFilter === schedule.data?.defaultStaffId),
      ),
    [schedule.data, staffFilter],
  )
  const live = useQuery({
    queryKey: ['fleet-trackers'],
    queryFn: () =>
      fetchJson<{ trackers: FleetTracker[] }>('/api/admin/fleet/trackers'),
    enabled: !future,
    refetchInterval: isToday ? 2000 : false,
  })
  const trackers = live.data?.trackers ?? []
  const selected =
    trackers.find((tracker) => tracker.id === selectedId) ?? trackers[0]
  const withinArchive =
    day >= mountainDateKey(new Date(now - 29 * 86400000)) && !future
  const history = useQuery({
    queryKey: ['fleet-tracker-history', selected?.id, day],
    queryFn: () =>
      fetchJson<{ points: TrackerHistoryPoint[] }>(
        `/api/admin/fleet/trackers/${selected!.id}/history?${new URLSearchParams(bounds!)}`,
      ),
    enabled: showHistory && !!selected && !!bounds && withinArchive,
    refetchInterval: showHistory && isToday ? 15000 : false,
  })
  const archivePoints = history.data?.points ?? NO_POINTS
  const drives = useMemo(() => driveIntervals(archivePoints), [archivePoints])
  const mapPoints =
    showHistory && !future && withinArchive
      ? selectedDrive === null
        ? archivePoints
        : (drives[selectedDrive]?.points ?? NO_POINTS)
      : NO_POINTS
  const dateLabel = isDispatchDay(day)
    ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : day
  const mapped = jobs.filter((job) => job.location).length
  const selectedJob = jobs.find((job) => job.id === selectedJobId)

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {!embedded && (
            <h2 className="text-xl font-semibold text-white">Live Dispatch</h2>
          )}
          <p className="font-medium text-slate-100">{dateLabel}</p>
          <p className="mt-1 text-xs text-slate-400">
            {isToday
              ? 'Today’s jobs and vehicle locations'
              : future
                ? 'Scheduled jobs · planning view'
                : 'Scheduled jobs · past day'}{' '}
            · Mountain Time
          </p>
        </div>
        {!embedded && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Dispatch date"
              type="date"
              value={day}
              onChange={(event) => {
                if (isDispatchDay(event.target.value)) {
                  setChosenDay(event.target.value)
                  setShowHistory(false)
                  setSelectedDrive(null)
                  setSelectedJobId('')
                }
              }}
              className="min-h-11 rounded-lg border border-white/20 bg-slate-900 px-3 text-white [color-scheme:dark]"
            />
            <Link
              href={`/admin/operations?date=${day}&view=day`}
              className="rounded-lg border border-white/15 px-3 py-3 text-sm"
            >
              Calendar
            </Link>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-sky-200">
          {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'} · {mapped} mapped
        </span>
        {isToday && (
          <span className="self-center text-xs text-slate-400">
            Vehicle positions refresh every 2 seconds
          </span>
        )}
        {staffFilter && (
          <span className="self-center text-xs text-slate-400">
            Calendar technician filter applied
          </span>
        )}
      </div>
      {schedule.error && (
        <p
          role="alert"
          className="rounded-xl bg-red-950/50 p-3 text-sm text-red-200"
        >
          {schedule.error.message}
        </p>
      )}
      {isToday && live.error && (
        <p
          role="alert"
          className="rounded-xl bg-red-950/50 p-3 text-sm text-red-200"
        >
          Vehicle positions could not refresh; displayed locations may be old.
        </p>
      )}
      {isToday && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {trackers.map((tracker) => (
            <button
              key={tracker.id}
              onClick={() => {
                setSelectedId(tracker.id)
                setFocusRequest((value) => value + 1)
              }}
              aria-pressed={tracker.id === selected?.id}
              className="min-h-11 shrink-0 rounded-xl border border-white/15 bg-slate-950/50 px-3 py-2 text-left text-sm text-white"
            >
              <Truck className="mr-2 inline h-4 w-4 text-emerald-400" />
              {tracker.name}
              <span className="ml-3 text-xs text-slate-400">
                {trackerStatus(tracker, now)}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-slate-950">
        <TrackerMap
          key={day}
          now={now}
          historyKey={`${day}:${showHistory}:${selected?.id}:${selectedDrive}`}
          trackers={isToday ? trackers : []}
          selectedId={selected?.id ?? ''}
          points={mapPoints}
          focusRequest={focusRequest}
          onSelect={setSelectedId}
          jobs={jobs}
          selectedJobId={selectedJobId}
          onSelectJob={setSelectedJobId}
        />
      </div>
      <p className="text-xs text-slate-400">
        Numbered pins are scheduled jobs.{' '}
        {isToday
          ? 'Round markers are vehicles; offline markers show their last reported location.'
          : 'Current vehicle locations are hidden on this date.'}{' '}
        Driving tracks appear only when you open the archive.
      </p>
      <section aria-label="Jobs for selected day" className="space-y-2">
        {schedule.isPending && (
          <p className="p-3 text-sm text-slate-400">Loading this day’s jobs…</p>
        )}
        {!schedule.isPending && !schedule.error && !jobs.length && (
          <p className="rounded-xl border border-white/10 p-4 text-sm text-slate-300">
            No scheduled jobs for this day.
          </p>
        )}
        {jobs.map((job, index) => (
          <div
            key={job.id}
            className={`rounded-xl border p-3 ${selectedJob?.id === job.id ? 'border-cyan-300/60 bg-sky-950/40' : 'border-white/10 bg-slate-950/40'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={job.href}
                className="min-h-11 min-w-0 flex-1 text-sm text-white"
              >
                <span className="mr-2 font-semibold text-sky-300">
                  {index + 1}
                </span>
                <span className="font-medium">{job.name}</span>
                <span className="mt-1 block text-xs text-slate-300">
                  {jobTime(job.start)} – {jobTime(job.end)} · {job.staffName}
                </span>
              </Link>
              {job.location && (
                <button
                  aria-label={`Locate ${job.name}`}
                  onClick={() => setSelectedJobId(job.id)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/15 text-sky-300"
                >
                  <MapPin className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-xs leading-5 text-slate-400">
              {job.address || 'No service address saved'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {job.status.replaceAll('_', ' ')}
              {!job.location && (
                <span className="ml-2 text-amber-300">
                  Location needs verification · no pin placed
                </span>
              )}
            </p>
          </div>
        ))}
      </section>
      <details
        open={showHistory}
        onToggle={(event) => {
          setShowHistory(event.currentTarget.open)
          if (!event.currentTarget.open) setSelectedDrive(null)
        }}
        className="rounded-xl border border-white/15 bg-slate-950/40 p-4"
      >
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-slate-200">
          Driving history · {day}
        </summary>
        {showHistory && (
          <div className="mt-2 space-y-3">
            <p className="text-xs leading-5 text-slate-400">
              GPS history is retained for 30 days. Motion intervals show
              observed driving times, not verified job arrivals. Signal gaps
              remain disconnected.
            </p>
            {future ? (
              <p className="text-sm text-slate-300">
                Driving history is available after travel is recorded.
              </p>
            ) : !withinArchive ? (
              <p className="text-sm text-slate-300">
                This day is outside the 30-day GPS archive.
              </p>
            ) : (
              <>
                <label className="block text-sm text-slate-300">
                  Vehicle
                  <select
                    aria-label="History vehicle"
                    value={selected?.id ?? ''}
                    onChange={(event) => {
                      setSelectedId(event.target.value)
                      setSelectedDrive(null)
                    }}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-white/20 bg-slate-900 px-3 text-white"
                  >
                    {trackers.map((tracker) => (
                      <option key={tracker.id} value={tracker.id}>
                        {tracker.name}
                      </option>
                    ))}
                  </select>
                </label>
                {history.error ? (
                  <p role="alert" className="text-sm text-amber-200">
                    History could not load. Try again shortly.
                  </p>
                ) : history.isPending && selected ? (
                  <p className="text-sm text-slate-400">
                    Loading recorded travel…
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">
                    {archivePoints.length
                      ? `${archivePoints.length.toLocaleString()} recorded GPS samples · ${drives.length} motion interval${drives.length === 1 ? '' : 's'}`
                      : 'No recorded travel for this vehicle on this day.'}
                  </p>
                )}
                {drives.length > 0 && (
                  <button
                    onClick={() => setSelectedDrive(null)}
                    className="min-h-11 rounded-lg border border-white/15 px-3 text-sm text-white"
                  >
                    Show full day’s recorded travel
                  </button>
                )}
                {drives.map((drive, index) => (
                  <button
                    key={drive.start}
                    aria-pressed={selectedDrive === index}
                    onClick={() => setSelectedDrive(index)}
                    className="flex min-h-11 w-full items-center justify-between rounded-lg border border-white/15 px-3 py-2 text-sm text-white"
                  >
                    <span>
                      <Navigation className="mr-2 inline h-4 w-4 text-emerald-400" />
                      {clock(drive.start)} – {clock(drive.end)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {Math.round(
                        (Date.parse(drive.end) - Date.parse(drive.start)) /
                          60000,
                      )}{' '}
                      min observed
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </details>
    </div>
  )
}
