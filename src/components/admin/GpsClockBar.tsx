'use client'

import { useState } from 'react'
import { useGpsContext } from '@/contexts/GpsTrackerContext'
import { GpsConsentModal } from '@/components/admin/GpsConsentModal'
import { Clock, LogIn, LogOut } from 'lucide-react'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Desktop-only GPS clock bar (fixed bottom, sm+ screens).
 * On mobile the nav tab inside MobileBottomNav handles clock in/out.
 */
export function GpsClockBar() {
  const {
    isClocked,
    segmentType,
    elapsedMs,
    error,
    clockIn,
    clockOut,
    consentGiven,
    grantConsent,
  } = useGpsContext()

  const [showConsent, setShowConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)

  async function handleClockIn() {
    if (!consentGiven) {
      setShowConsent(true)
      return
    }
    setLoading(true)
    await clockIn()
    setLoading(false)
  }

  async function handleClockOut() {
    if (!confirmOut) {
      setConfirmOut(true)
      return
    }
    setLoading(true)
    await clockOut()
    setLoading(false)
    setConfirmOut(false)
  }

  function handleConsentAccept() {
    grantConsent()
    setShowConsent(false)
    void handleClockIn()
  }

  const segmentColor =
    segmentType === 'on_site'
      ? 'bg-emerald-600 hover:bg-emerald-500'
      : segmentType === 'traveling'
        ? 'bg-blue-600 hover:bg-blue-500'
        : 'bg-slate-700 hover:bg-slate-600'

  return (
    <>
      {showConsent && (
        <GpsConsentModal
          onAccept={handleConsentAccept}
          onDismiss={() => setShowConsent(false)}
        />
      )}

      {/* Desktop only — hidden on mobile (sm:hidden inverse = hidden sm:flex) */}
      <div
        className="fixed right-0 bottom-0 left-0 z-[150] hidden border-t border-white/10 px-4 py-2 sm:flex sm:items-center sm:justify-center"
        style={{
          background: 'rgba(15, 23, 42, 0.94)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div className="flex w-full max-w-sm items-center gap-3">
          {isClocked ? (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[10px] font-medium tracking-widest text-slate-500 uppercase">
                  {segmentType === 'on_site'
                    ? 'On-Site'
                    : segmentType === 'traveling'
                      ? 'Traveling'
                      : 'Clocked In'}
                </span>
                <span className="font-mono text-base font-bold text-white tabular-nums">
                  {formatElapsed(elapsedMs)}
                </span>
              </div>

              <div className="relative flex h-8 w-8 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-20" />
                <Clock className="relative h-4 w-4 text-emerald-400" />
              </div>

              <button
                onClick={handleClockOut}
                disabled={loading}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                  confirmOut ? 'bg-red-600 hover:bg-red-500' : segmentColor
                }`}
              >
                <LogOut className="h-4 w-4" />
                {loading ? 'Saving…' : confirmOut ? 'Confirm Out' : 'Clock Out'}
              </button>

              {confirmOut && (
                <button
                  onClick={() => setConfirmOut(false)}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Cancel
                </button>
              )}
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[10px] font-medium tracking-widest text-slate-500 uppercase">
                  GPS Tracking
                </span>
                <span className="text-sm font-semibold text-slate-400">
                  Not clocked in
                </span>
              </div>

              <button
                onClick={handleClockIn}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {loading ? 'Starting…' : 'Clock In'}
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="mt-1 text-center text-xs text-red-400">{error}</p>
        )}
      </div>
    </>
  )
}
