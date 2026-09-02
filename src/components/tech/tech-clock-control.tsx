'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Coffee, Loader2, LogIn, LogOut, RotateCcw } from 'lucide-react'

type ClockEntry = {
  id: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  clockState: 'active' | 'on_break' | 'complete'
}

type RecentClockOut = {
  id: string
  startedAt: string
  endedAt: string
  payableMinutes: number
  canUndoUntil: string
  clockInAllowedAt: string
}

type ClockStatus = {
  entry: ClockEntry | null
  recentClockOut: RecentClockOut | null
}

type MeterAsset = {
  id: string
  name: string
  meter_type: 'miles' | 'hours' | 'none'
  current_meter: number | null
}

const REQUEST_TIMEOUT_MS = 15_000
const STATUS_POLL_MS = 60_000
// The confirm button stays disarmed briefly so a double-tap on "Clock Out"
// can't land on "Yes, clock out" in the same spot.
const CONFIRM_ARM_DELAY_MS = 1_200

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

function formatClockTime(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

export function TechClockControl() {
  const [entry, setEntry] = useState<ClockEntry | null>(null)
  const [recentClockOut, setRecentClockOut] = useState<RecentClockOut | null>(
    null,
  )
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [loading, setLoading] = useState<string | null>('status')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmArmed, setConfirmArmed] = useState(false)

  const [meterAssets, setMeterAssets] = useState<MeterAsset[] | null>(null)
  const [meterValues, setMeterValues] = useState<Record<string, string>>({})
  const [meterSaving, setMeterSaving] = useState(false)
  const [meterError, setMeterError] = useState<string | null>(null)

  const busyRef = useRef(false)

  const applyStatus = useCallback((status: Partial<ClockStatus>) => {
    const nextEntry = status.entry ?? null
    setEntry(
      nextEntry && nextEntry.clockState !== 'complete' ? nextEntry : null,
    )
    setRecentClockOut(status.recentClockOut ?? null)
  }, [])

  const loadStatus = useCallback(
    async (options?: { quiet?: boolean }) => {
      try {
        const res = await fetchWithTimeout('/api/tech/time-clock', {
          cache: 'no-store',
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload.error || 'Unable to load clock')
        applyStatus(payload)
        if (!options?.quiet) setError(null)
      } catch (loadError) {
        if (options?.quiet) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load clock',
        )
      } finally {
        setLoading((current) => (current === 'status' ? null : current))
      }
    },
    [applyStatus],
  )

  // Initial load, then keep the phone honest: re-check whenever the tab comes
  // back to the foreground and on a slow poll. A page iOS has kept alive since
  // yesterday must never show yesterday's clock state.
  useEffect(() => {
    void loadStatus()

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busyRef.current) {
        void loadStatus({ quiet: true })
      }
    }
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busyRef.current) {
        void loadStatus({ quiet: true })
      }
    }, STATUS_POLL_MS)

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [loadStatus])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!confirmOpen) {
      setConfirmArmed(false)
      return
    }
    const timer = window.setTimeout(
      () => setConfirmArmed(true),
      CONFIRM_ARM_DELAY_MS,
    )
    return () => window.clearTimeout(timer)
  }, [confirmOpen])

  const elapsedMs = useMemo(() => {
    if (!entry) return 0
    return nowMs - new Date(entry.startedAt).getTime()
  }, [entry, nowMs])

  const undoAvailable =
    !entry &&
    recentClockOut !== null &&
    nowMs < new Date(recentClockOut.canUndoUntil).getTime()
  const clockInBlocked =
    !entry &&
    recentClockOut !== null &&
    nowMs < new Date(recentClockOut.clockInAllowedAt).getTime()

  async function loadMeterAssets() {
    try {
      const res = await fetch('/api/field/fleet', { cache: 'no-store' })
      const payload = await res.json().catch(() => ({}))
      const assets = ((payload.assets ?? []) as MeterAsset[]).filter(
        (a) => a.meter_type !== 'none',
      )
      if (assets.length > 0) {
        setMeterAssets(assets)
        setMeterValues({})
        setMeterError(null)
      }
    } catch {
      // Non-critical — the tech can still log hours later from Gears/Admin.
    }
  }

  async function submitMeters() {
    if (!meterAssets) return
    setMeterSaving(true)
    setMeterError(null)
    try {
      const entries = meterAssets
        .map((a) => ({ asset: a, value: meterValues[a.id]?.trim() }))
        .filter((e) => e.value)
      for (const e of entries) {
        const res = await fetch('/api/field/fleet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId: e.asset.id,
            reading: Number(e.value),
          }),
        })
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}))
          throw new Error(payload.error || `Couldn't save ${e.asset.name}`)
        }
      }
      setMeterAssets(null)
    } catch (err) {
      setMeterError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setMeterSaving(false)
    }
  }

  async function runAction(action: string) {
    if (busyRef.current) return
    busyRef.current = true
    setLoading(action)
    setError(null)
    setNotice(null)
    try {
      const res = await fetchWithTimeout('/api/tech/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          clientSentAt: new Date().toISOString(),
        }),
      })
      const payload = await res.json().catch(() => ({}))

      if (!res.ok) {
        // The server sends its real state back with every rejection. Show
        // that, not what the phone assumed — "Already clocked in" means the
        // earlier tap DID go through.
        if (payload && ('entry' in payload || 'recentClockOut' in payload)) {
          applyStatus(payload)
          setNotice(payload.error || 'Your clock status was refreshed.')
          return
        }
        throw new Error(payload.error || 'Unable to update clock')
      }

      applyStatus(payload)
      if (action === 'clock_out' && payload.recentClockOut) {
        setNotice(
          `Clocked out at ${formatClockTime(payload.recentClockOut.endedAt)}. Tapped by mistake? Use Undo.`,
        )
      }
      if (action === 'undo_clock_out') {
        setNotice('Back on the clock. Your shift kept its original start time.')
      }
      if (action === 'clock_in') {
        void loadMeterAssets()
      }
    } catch (actionError) {
      const aborted =
        actionError instanceof DOMException && actionError.name === 'AbortError'
      setError(
        aborted
          ? 'No response from the server. Check your signal — your real status is shown below once it reconnects.'
          : actionError instanceof Error
            ? actionError.message
            : 'Unable to update clock',
      )
      // The request may have landed even though the reply never arrived.
      // Reload so the buttons reflect the truth instead of the last guess.
      await loadStatus({ quiet: true })
    } finally {
      busyRef.current = false
      setLoading(null)
      setConfirmOpen(false)
    }
  }

  const isClocked = Boolean(entry)
  const isOnBreak = entry?.clockState === 'on_break'
  const isLoadingStatus = loading === 'status'

  return (
    <div className="fixed right-0 bottom-0 left-0 z-[220] border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            <Clock className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-widest text-slate-500 uppercase">
              {isOnBreak
                ? 'On Break'
                : isClocked
                  ? 'Clocked In'
                  : undoAvailable
                    ? 'Clocked Out'
                    : 'Time Clock'}
            </p>
            <p className="font-mono text-sm font-semibold text-white">
              {isLoadingStatus
                ? 'Loading...'
                : isClocked
                  ? formatElapsed(elapsedMs)
                  : undoAvailable && recentClockOut
                    ? `Out at ${formatClockTime(recentClockOut.endedAt)}`
                    : 'Not clocked in'}
            </p>
          </div>
        </div>

        {isClocked ? (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() =>
              void runAction(isOnBreak ? 'end_break' : 'start_break')
            }
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-60 ${
              isOnBreak
                ? 'bg-amber-600 text-white'
                : 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/40'
            }`}
          >
            <Coffee className="h-4 w-4" />
            {loading === 'start_break' || loading === 'end_break'
              ? 'Saving...'
              : isOnBreak
                ? 'End Break'
                : 'Start Break'}
          </button>
        ) : null}

        {isClocked ? (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => setConfirmOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-400/30 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {loading === 'clock_out' ? 'Saving...' : 'Clock Out'}
          </button>
        ) : undoAvailable ? (
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => void runAction('undo_clock_out')}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            <RotateCcw className="h-4 w-4" />
            {loading === 'undo_clock_out' ? 'Saving...' : 'Undo Clock Out'}
          </button>
        ) : (
          <button
            type="button"
            disabled={loading !== null || clockInBlocked}
            onClick={() => void runAction('clock_in')}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {loading === 'clock_in' ? 'Saving...' : 'Clock In'}
          </button>
        )}
      </div>

      {undoAvailable && !clockInBlocked ? (
        <div className="mx-auto mt-2 flex max-w-3xl justify-end">
          <button
            type="button"
            disabled={loading !== null}
            onClick={() => void runAction('clock_in')}
            className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
          >
            Start a new shift instead
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-emerald-200">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-red-300">{error}</p>
      ) : null}

      {confirmOpen && entry ? (
        <div
          className="fixed inset-0 z-[230] flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-slate-900 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <p className="text-base font-semibold text-white">
                Clock out now?
              </p>
              <p className="mt-1 text-sm text-slate-400">
                You clocked in at {formatClockTime(entry.startedAt)} and have
                been on the clock for {formatHoursMinutes(elapsedMs)}.
                {isOnBreak ? ' Your break will end too.' : ''}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Just stepping away? Use Start Break instead so your shift stays
                open.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-lg bg-white/10 py-3 text-sm font-semibold text-white hover:bg-white/20"
              >
                Keep working
              </button>
              <button
                type="button"
                disabled={!confirmArmed || loading !== null}
                onClick={() => void runAction('clock_out')}
                className="flex-1 rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {loading === 'clock_out' ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  'Yes, clock out'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {meterAssets ? (
        <div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-slate-900 p-4">
            <p className="text-sm font-semibold text-white">
              Log today&apos;s machine hours
            </p>
            {meterAssets.map((a) => (
              <div key={a.id} className="space-y-1">
                <label className="text-xs text-slate-400">
                  {a.name} —{' '}
                  {a.meter_type === 'hours' ? 'engine hours' : 'odometer miles'}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={meterValues[a.id] ?? ''}
                  onChange={(e) =>
                    setMeterValues((prev) => ({
                      ...prev,
                      [a.id]: e.target.value,
                    }))
                  }
                  placeholder={
                    a.current_meter != null ? `> ${a.current_meter}` : '0'
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-base outline-none focus:border-white/40"
                />
              </div>
            ))}
            {meterError ? (
              <p className="text-xs text-red-400">{meterError}</p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMeterAssets(null)}
                className="flex-1 rounded-lg bg-white/10 py-2.5 text-sm font-medium hover:bg-white/20"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={() => void submitMeters()}
                disabled={meterSaving}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60"
              >
                {meterSaving ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
