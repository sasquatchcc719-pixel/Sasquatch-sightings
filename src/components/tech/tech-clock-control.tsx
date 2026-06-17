'use client'

import { useState } from 'react'
import { Clock, Coffee, LogIn, LogOut } from 'lucide-react'
import { useGpsContextOptional } from '@/contexts/GpsTrackerContext'
import { GpsConsentModal } from '@/components/admin/GpsConsentModal'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function TechClockControl() {
  const gps = useGpsContextOptional()
  const [showConsent, setShowConsent] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [confirmOut, setConfirmOut] = useState(false)

  if (!gps?.gpsEnabled) return null

  async function handleClockIn() {
    if (!gps) return
    if (!gps.consentGiven) {
      setShowConsent(true)
      return
    }
    setLoading('clock')
    await gps.clockIn()
    setLoading(null)
  }

  async function handleClockOut() {
    if (!gps) return
    if (!confirmOut) {
      setConfirmOut(true)
      setTimeout(() => setConfirmOut(false), 3000)
      return
    }
    setLoading('clock')
    await gps.clockOut()
    setLoading(null)
    setConfirmOut(false)
  }

  async function handleConsentAccept() {
    if (!gps) return
    gps.grantConsent()
    setShowConsent(false)
    setLoading('clock')
    await gps.clockIn()
    setLoading(null)
  }

  async function handleBreakToggle() {
    if (!gps?.isClocked) return
    setLoading('break')
    if (gps.isOnBreak) {
      await gps.endBreak()
    } else {
      await gps.startBreak()
    }
    setLoading(null)
  }

  return (
    <>
      {showConsent ? (
        <GpsConsentModal
          onAccept={() => void handleConsentAccept()}
          onDismiss={() => setShowConsent(false)}
        />
      ) : null}

      <div className="fixed right-0 bottom-0 left-0 z-[220] border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
              <Clock className="h-5 w-5 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-widest text-slate-500 uppercase">
                {gps.isOnBreak
                  ? 'On Break'
                  : gps.isClocked
                    ? gps.segmentType.replace('_', ' ')
                    : 'Time Clock'}
              </p>
              <p className="font-mono text-sm font-semibold text-white">
                {gps.isOnBreak
                  ? `Break ${formatElapsed(gps.breakElapsedMs)}`
                  : gps.isClocked
                    ? formatElapsed(gps.elapsedMs)
                    : 'Not clocked in'}
              </p>
            </div>
          </div>

          {gps.isClocked ? (
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => void handleBreakToggle()}
              className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${
                gps.isOnBreak
                  ? 'bg-amber-600'
                  : 'bg-slate-800 ring-1 ring-white/10'
              }`}
            >
              <Coffee className="h-4 w-4" />
              {loading === 'break'
                ? 'Saving...'
                : gps.isOnBreak
                  ? 'End Break'
                  : 'Start Break'}
            </button>
          ) : null}

          <button
            type="button"
            disabled={loading !== null}
            onClick={() =>
              gps.isClocked ? void handleClockOut() : void handleClockIn()
            }
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 ${
              confirmOut
                ? 'bg-red-600'
                : gps.isClocked
                  ? 'bg-slate-700'
                  : 'bg-emerald-600'
            }`}
          >
            {gps.isClocked ? (
              <LogOut className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {loading === 'clock'
              ? 'Saving...'
              : confirmOut
                ? 'Confirm'
                : gps.isClocked
                  ? 'Clock Out'
                  : 'Clock In'}
          </button>
        </div>
        {gps.error ? (
          <p className="mx-auto mt-2 max-w-3xl text-xs text-red-300">
            {gps.error}
          </p>
        ) : null}
      </div>
    </>
  )
}
