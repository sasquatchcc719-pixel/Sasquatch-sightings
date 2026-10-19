'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Footprints, LockKeyhole } from 'lucide-react'

export function CanvassPocketMode({
  duration,
  distance,
  accuracy,
  error,
  onExit,
}: {
  duration: string
  distance: string
  accuracy: number | null
  error: string | null
  onExit: () => void
}) {
  const [awake, setAwake] = useState<boolean | null>(null)
  const [holding, setHolding] = useState(false)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelHold = useCallback(() => {
    if (holdRef.current) clearTimeout(holdRef.current)
    holdRef.current = null
    setHolding(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    let pending = false
    let lock: WakeLockSentinel | null = null
    // Own this screen's lock separately: revealing the controls must leave
    // the tracker's existing wake lock and GPS recording running.
    const acquire = async () => {
      if (pending || (lock && !lock.released)) return
      if (!('wakeLock' in navigator)) {
        setAwake(false)
        return
      }
      pending = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await next.release()
          return
        }
        lock = next
        setAwake(!next.released)
        next.addEventListener('release', () => {
          if (!cancelled && lock === next) setAwake(false)
        })
      } catch {
        if (!cancelled) setAwake(false)
      } finally {
        pending = false
      }
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void acquire()
      else cancelHold()
    }
    void acquire()
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('blur', cancelHold)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('blur', cancelHold)
      void lock?.release()
      if (holdRef.current) clearTimeout(holdRef.current)
    }
  }, [cancelHold])
  const beginHold = () => {
    if (holdRef.current) return
    setHolding(true)
    holdRef.current = setTimeout(onExit, 2000)
  }

  return (
    <main className="fixed inset-0 z-[1000] flex touch-pan-y flex-col items-center overflow-y-auto bg-black px-6 py-8 text-center text-slate-400 select-none [-webkit-touch-callout:none]">
      <div className="my-auto flex w-full shrink-0 flex-col items-center">
        <LockKeyhole aria-hidden="true" className="mb-4 h-6 w-6" />
        <h1 className="text-xs font-medium tracking-[0.3em] uppercase">
          Pocket mode
        </h1>
        <p className="mt-6 flex items-center gap-2 text-lg font-medium text-slate-300">
          <Footprints aria-hidden="true" className="h-5 w-5" /> Canvassing
          active
        </p>
        <p className="mt-3 text-3xl tabular-nums">{duration}</p>
        <p className="mt-2 text-sm">{distance}</p>
        <p
          className={`mt-4 max-w-xs text-sm ${error ? 'text-amber-400' : ''}`}
          role="status"
        >
          {error ??
            (accuracy == null || accuracy > 50
              ? 'Waiting for accurate GPS…'
              : `GPS accuracy ±${Math.round(accuracy)}m`)}
        </p>
        <p
          className={`mt-3 max-w-xs text-xs ${awake === false ? 'text-amber-400' : ''}`}
        >
          {awake === null
            ? 'Enabling keep-awake…'
            : awake
              ? 'Keep-awake enabled'
              : 'Keep-awake unavailable. Adjust Auto-Lock before pocketing your phone.'}
        </p>
        <p className="mt-8 max-w-xs text-sm leading-relaxed">
          Keep this page open and your phone unlocked. Lower screen brightness
          before pocketing. Do not lock it with the side button.
        </p>
        <button
          type="button"
          className="relative mt-10 w-full max-w-xs touch-none overflow-hidden rounded-2xl border border-slate-800 px-5 py-5 text-sm text-slate-300 outline-offset-4 focus-visible:outline"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            beginHold()
          }}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onKeyDown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            if (!event.repeat) beginHold()
          }}
          onKeyUp={cancelHold}
          onBlur={cancelHold}
          onClick={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span
            aria-hidden="true"
            className="absolute inset-0 origin-left bg-slate-800 transition-transform ease-linear motion-reduce:transition-none"
            style={{
              transform: `scaleX(${holding ? 1 : 0})`,
              transitionDuration: holding ? '2000ms' : '0ms',
            }}
          />
          <span className="relative">Hold 2 seconds to show controls</span>
        </button>
        <p className="mt-3 text-xs">
          Recording continues when you show the controls.
        </p>
      </div>
    </main>
  )
}
