'use client'

import { useGpsContext } from '@/contexts/GpsTrackerContext'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function AccuracyDot({ accuracy }: { accuracy: number | null }) {
  if (accuracy === null)
    return (
      <span className="h-2 w-2 rounded-full bg-slate-600" title="No GPS fix" />
    )
  if (accuracy <= 20)
    return (
      <span
        className="h-2 w-2 rounded-full bg-emerald-400"
        title={`±${Math.round(accuracy)}m`}
      />
    )
  if (accuracy <= 60)
    return (
      <span
        className="h-2 w-2 rounded-full bg-yellow-400"
        title={`±${Math.round(accuracy)}m`}
      />
    )
  return (
    <span
      className="h-2 w-2 rounded-full bg-red-400"
      title={`±${Math.round(accuracy)}m`}
    />
  )
}

export function GpsStatusBar() {
  const {
    isClocked,
    segmentType,
    activeAppointmentLabel,
    elapsedMs,
    accuracy,
  } = useGpsContext()

  if (!isClocked) return null

  const segmentLabel =
    segmentType === 'on_site' && activeAppointmentLabel
      ? `On-Site · ${activeAppointmentLabel}`
      : segmentType === 'on_site'
        ? 'On-Site'
        : segmentType === 'traveling'
          ? 'Traveling'
          : 'Idle'

  const segmentColor =
    segmentType === 'on_site'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : segmentType === 'traveling'
        ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
        : 'bg-slate-700/40 text-slate-400 border-slate-600/30'

  return (
    <div
      className="fixed top-14 right-0 left-0 z-[120] flex items-center justify-between gap-3 border-b border-white/5 px-4 py-1.5 sm:top-14"
      style={{
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AccuracyDot accuracy={accuracy} />
        <span
          className={`inline-flex items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${segmentColor}`}
        >
          {segmentLabel}
        </span>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-slate-400">
        Shift {formatElapsed(elapsedMs)}
      </span>
    </div>
  )
}
