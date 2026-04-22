'use client'

import { MapPin, X } from 'lucide-react'

export function GpsConsentModal({
  onAccept,
  onDismiss,
}: {
  onAccept: () => void
  onDismiss: () => void
}) {
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center pb-16 sm:items-center sm:pb-0">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onDismiss}
      />
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border border-white/10 p-6"
        style={{ background: 'rgba(15, 23, 42, 0.97)' }}
      >
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 text-slate-500 hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
          <MapPin className="h-5 w-5 text-emerald-400" />
        </div>

        <h2 className="mb-2 text-base font-bold text-white">
          Enable GPS Tracking
        </h2>
        <p className="mb-1 text-sm text-slate-300">
          When you clock in, this app will track your location to:
        </p>
        <ul className="mb-4 space-y-1 text-sm text-slate-400">
          <li>· Measure travel time vs. on-site time per job</li>
          <li>· Auto-detect arrival at each customer address</li>
          <li>· Build timesheet reports for job costing</li>
        </ul>
        <p className="mb-4 text-xs text-slate-500">
          Tracking only runs while the app is open and you&apos;re clocked in.
          Data is visible to admin and stored for 90 days (raw GPS), then
          retained as summary records only.
        </p>

        <button
          onClick={onAccept}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
        >
          I understand — Enable GPS
        </button>
      </div>
    </div>
  )
}
