'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Coffee, Loader2, LogIn, LogOut } from 'lucide-react'

type ClockEntry = {
  id: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  clockState: 'active' | 'on_break' | 'complete'
}

type MeterAsset = {
  id: string
  name: string
  meter_type: 'miles' | 'hours' | 'none'
  current_meter: number | null
}

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

export function TechClockControl() {
  const [entry, setEntry] = useState<ClockEntry | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [loading, setLoading] = useState<string | null>('status')
  const [error, setError] = useState<string | null>(null)
  const [confirmOut, setConfirmOut] = useState(false)
  const [clockInBlockedUntil, setClockInBlockedUntil] = useState<number | null>(
    null,
  )

  const [meterAssets, setMeterAssets] = useState<MeterAsset[] | null>(null)
  const [meterValues, setMeterValues] = useState<Record<string, string>>({})
  const [meterSaving, setMeterSaving] = useState(false)
  const [meterError, setMeterError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function loadStatus() {
      try {
        const res = await fetch('/api/tech/time-clock', { cache: 'no-store' })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload.error || 'Unable to load clock')
        if (alive) setEntry(payload.entry || null)
      } catch (loadError) {
        if (alive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load clock',
          )
        }
      } finally {
        if (alive) setLoading(null)
      }
    }

    void loadStatus()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const elapsedMs = useMemo(() => {
    if (!entry) return 0
    return nowMs - new Date(entry.startedAt).getTime()
  }, [entry, nowMs])

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
    setLoading(action)
    setError(null)
    try {
      const res = await fetch('/api/tech/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || 'Unable to update clock')
      setEntry(payload.entry?.clockState === 'complete' ? null : payload.entry)
      if (action === 'clock_out') {
        setClockInBlockedUntil(Date.now() + 5000)
      }
      if (action === 'clock_in') {
        void loadMeterAssets()
      }
      setConfirmOut(false)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Unable to update clock',
      )
    } finally {
      setLoading(null)
    }
  }

  async function handleClockOut() {
    if (!confirmOut) {
      setConfirmOut(true)
      window.setTimeout(() => setConfirmOut(false), 3000)
      return
    }
    await runAction('clock_out')
  }

  const isClocked = Boolean(entry)
  const isOnBreak = entry?.clockState === 'on_break'
  const isClockInBlocked =
    !isClocked && clockInBlockedUntil !== null && nowMs < clockInBlockedUntil

  return (
    <div className="fixed right-0 bottom-0 left-0 z-[220] border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            <Clock className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-widest text-slate-500 uppercase">
              {isOnBreak ? 'On Break' : isClocked ? 'Clocked In' : 'Time Clock'}
            </p>
            <p className="font-mono text-sm font-semibold text-white">
              {loading === 'status'
                ? 'Loading...'
                : isClocked
                  ? formatElapsed(elapsedMs)
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
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${
              isOnBreak ? 'bg-amber-600' : 'bg-slate-800 ring-1 ring-white/10'
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

        <button
          type="button"
          disabled={loading !== null || isClockInBlocked}
          onClick={() =>
            isClocked ? void handleClockOut() : void runAction('clock_in')
          }
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${
            confirmOut
              ? 'bg-red-600'
              : isClocked
                ? 'bg-slate-700'
                : 'bg-emerald-600'
          }`}
        >
          {isClocked ? (
            <LogOut className="h-4 w-4" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {loading === 'clock_in' || loading === 'clock_out'
            ? 'Saving...'
            : confirmOut
              ? 'Confirm'
              : isClockInBlocked
                ? 'Clocked Out'
                : isClocked
                  ? 'Clock Out'
                  : 'Clock In'}
        </button>
      </div>
      {error ? (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-red-300">{error}</p>
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
