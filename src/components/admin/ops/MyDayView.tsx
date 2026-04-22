'use client'

import { useEffect, useState } from 'react'
import {
  Clock,
  MapPin,
  Navigation,
  CheckCircle,
  AlertCircle,
} from 'lucide-react'

function fmtMin(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

type MyDayShift = {
  shiftId: string
  shiftStartedAt: string
  shiftEndedAt: string | null
  shiftStatus: string
  totalShiftMinutes: number
  totalOnSiteMinutes: number
  totalTravelMinutes: number
  idleMinutes: number
  totalDistanceM: number
  appointments: {
    appointmentId: string
    customer: string
    address: string
    quotedTotal: number
    currentBillingMinutes: number
    gpsTravelMinutes: number | null
    gpsOnSiteMinutes: number
    varianceMinutes: number | null
    arrivedAt: string | null
    onMyWayAt: string | null
    completedAt: string | null
    hasGpsData: boolean
  }[]
}

export function MyDayView() {
  const [data, setData] = useState<MyDayShift | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    fetch(`/api/admin/ops/gps/timesheets?date=${today}`)
      .then((r) => r.json())
      .then((d) => {
        // Show the first (most recent) shift for today
        setData(d.rows?.[d.rows.length - 1] ?? null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500">Loading your day…</div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-800/30 px-6 py-12 text-center">
        <Clock className="mx-auto mb-3 h-8 w-8 text-slate-600" />
        <p className="text-slate-400">No shift recorded for today yet.</p>
        <p className="mt-1 text-xs text-slate-600">
          Clock in using the button at the bottom of the screen to start
          tracking.
        </p>
      </div>
    )
  }

  const statusColor =
    data.shiftStatus === 'active'
      ? 'text-emerald-400'
      : data.shiftStatus === 'abandoned'
        ? 'text-red-400'
        : 'text-slate-400'

  return (
    <div className="space-y-4">
      {/* Shift summary card */}
      <div className="rounded-2xl border border-white/10 bg-slate-800/30 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Today&apos;s Shift</h3>
            <p className={`text-xs font-medium capitalize ${statusColor}`}>
              {data.shiftStatus === 'active' ? '● Active' : data.shiftStatus}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-400">
              {fmtTime(data.shiftStartedAt)}
              {data.shiftEndedAt && ` → ${fmtTime(data.shiftEndedAt)}`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-700/40 p-3 text-center">
            <p className="mb-1 text-xs text-slate-500">Total Shift</p>
            <p className="font-mono text-lg font-bold text-white">
              {fmtMin(data.totalShiftMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-blue-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-slate-500">Travel</p>
            <p className="font-mono text-lg font-bold text-blue-400">
              {fmtMin(data.totalTravelMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-slate-500">On-Site</p>
            <p className="font-mono text-lg font-bold text-emerald-400">
              {fmtMin(data.totalOnSiteMinutes)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-700/40 p-3 text-center">
            <p className="mb-1 text-xs text-slate-500">Idle</p>
            <p className="font-mono text-lg font-bold text-slate-400">
              {fmtMin(data.idleMinutes)}
            </p>
          </div>
        </div>
      </div>

      {/* Per-job breakdown */}
      {data.appointments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold tracking-widest text-slate-400 uppercase">
            Jobs
          </h3>
          {data.appointments.map((appt) => (
            <div
              key={appt.appointmentId}
              className="space-y-3 rounded-2xl border border-white/10 bg-slate-800/30 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">
                    {appt.customer}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-slate-400">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {appt.address}
                  </p>
                </div>
                {appt.completedAt ? (
                  <CheckCircle className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <Clock className="h-5 w-5 shrink-0 text-yellow-500" />
                )}
              </div>

              {/* Timeline */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="mb-0.5 text-slate-500">On My Way</p>
                  <p className="flex items-center gap-1 text-slate-300">
                    <Navigation className="h-3 w-3 text-blue-400" />
                    {fmtTime(appt.onMyWayAt)}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-slate-500">Arrived</p>
                  <p className="flex items-center gap-1 text-slate-300">
                    <MapPin className="h-3 w-3 text-emerald-400" />
                    {appt.hasGpsData ? fmtTime(appt.arrivedAt) : 'No GPS'}
                  </p>
                </div>
                <div>
                  <p className="mb-0.5 text-slate-500">Completed</p>
                  <p className="flex items-center gap-1 text-slate-300">
                    <CheckCircle className="h-3 w-3 text-slate-400" />
                    {fmtTime(appt.completedAt)}
                  </p>
                </div>
              </div>

              {/* Time split */}
              {appt.hasGpsData && (
                <div className="flex gap-4 text-xs">
                  <span className="text-blue-400">
                    Travel: {fmtMin(appt.gpsTravelMinutes)}
                  </span>
                  <span className="text-emerald-400">
                    On-Site: {fmtMin(appt.gpsOnSiteMinutes)}
                  </span>
                  {appt.varianceMinutes !== null && (
                    <span
                      className={
                        Math.abs(appt.varianceMinutes) <= 10
                          ? 'text-slate-500'
                          : 'text-yellow-500'
                      }
                    >
                      <AlertCircle className="mr-0.5 inline h-3 w-3" />
                      Variance: {appt.varianceMinutes > 0 ? '+' : ''}
                      {fmtMin(appt.varianceMinutes)}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-600">
        GPS data is preview only. Billing and payroll are unchanged.
      </p>
    </div>
  )
}
