'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Coffee, LogIn, LogOut } from 'lucide-react'

type ClockEntry = {
  id: string
  startedAt: string
  endedAt: string
  breakMinutes: number
  payableMinutes: number
  clockState: 'active' | 'on_break' | 'complete'
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
    </div>
  )
}
