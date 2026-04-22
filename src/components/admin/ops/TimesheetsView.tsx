'use client'

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Navigation,
  MapPin,
  Download,
  AlertCircle,
} from 'lucide-react'

function fmtMin(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtMiles(meters: number): string {
  return (meters * 0.000621371).toFixed(1) + ' mi'
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

type AppointmentRow = {
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
}

type ShiftRow = {
  shiftId: string
  userId: string
  displayName: string
  role: string
  shiftStartedAt: string
  shiftEndedAt: string | null
  shiftStatus: string
  totalShiftMinutes: number
  totalOnSiteMinutes: number
  totalTravelMinutes: number
  idleMinutes: number
  totalDistanceM: number
  appointments: AppointmentRow[]
}

async function fetchTimesheets(
  date: string,
): Promise<{ date: string; rows: ShiftRow[] }> {
  const res = await fetch(`/api/admin/ops/gps/timesheets?date=${date}`)
  if (!res.ok) throw new Error('Failed to load timesheets')
  return res.json()
}

function exportCsv(rows: ShiftRow[], date: string) {
  const headers = [
    'Date',
    'Technician',
    'Shift Start',
    'Shift End',
    'Total Shift',
    'Customer',
    'Address',
    'On-My-Way',
    'Arrived (GPS)',
    'Completed',
    'Travel (GPS)',
    'On-Site (GPS)',
    'Current Billing Method',
    'Variance',
    'Quoted $',
  ]

  const csvLines: string[] = [headers.join(',')]

  for (const row of rows) {
    if (row.appointments.length === 0) {
      csvLines.push(
        [
          date,
          row.displayName,
          fmtTime(row.shiftStartedAt),
          fmtTime(row.shiftEndedAt),
          fmtMin(row.totalShiftMinutes),
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ].join(','),
      )
    } else {
      for (const appt of row.appointments) {
        csvLines.push(
          [
            date,
            row.displayName,
            fmtTime(row.shiftStartedAt),
            fmtTime(row.shiftEndedAt),
            fmtMin(row.totalShiftMinutes),
            `"${appt.customer}"`,
            `"${appt.address}"`,
            fmtTime(appt.onMyWayAt),
            appt.hasGpsData ? fmtTime(appt.arrivedAt) : 'No GPS',
            fmtTime(appt.completedAt),
            appt.hasGpsData ? fmtMin(appt.gpsTravelMinutes) : 'No GPS',
            appt.hasGpsData ? fmtMin(appt.gpsOnSiteMinutes) : 'No GPS',
            fmtMin(appt.currentBillingMinutes),
            appt.varianceMinutes !== null
              ? fmtMin(appt.varianceMinutes)
              : 'No GPS',
            `$${appt.quotedTotal.toFixed(2)}`,
          ].join(','),
        )
      }
    }
  }

  const blob = new Blob([csvLines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `timesheets-${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function ShiftCard({ row }: { row: ShiftRow }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
              row.shiftStatus === 'active'
                ? 'bg-emerald-600'
                : row.shiftStatus === 'abandoned'
                  ? 'bg-red-700'
                  : 'bg-slate-600'
            }`}
          >
            {row.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-white">
              {row.displayName}
            </p>
            <p className="text-xs text-slate-400 capitalize">{row.role}</p>
          </div>
        </div>

        <div className="ml-4 flex shrink-0 items-center gap-6 text-sm text-slate-300">
          <div className="hidden flex-col items-end text-right sm:flex">
            <span className="text-xs text-slate-500">Shift</span>
            <span className="font-mono">{fmtMin(row.totalShiftMinutes)}</span>
          </div>
          <div className="hidden flex-col items-end text-right sm:flex">
            <span className="text-xs text-slate-500">Travel</span>
            <span className="font-mono text-blue-400">
              {fmtMin(row.totalTravelMinutes)}
            </span>
          </div>
          <div className="flex flex-col items-end text-right">
            <span className="text-xs text-slate-500">On-Site</span>
            <span className="font-mono text-emerald-400">
              {fmtMin(row.totalOnSiteMinutes)}
            </span>
          </div>
          <div className="hidden flex-col items-end text-right sm:flex">
            <span className="text-xs text-slate-500">Distance</span>
            <span className="font-mono text-slate-300">
              {fmtMiles(row.totalDistanceM)}
            </span>
          </div>
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
          )}
        </div>
      </button>

      {/* Expanded appointments */}
      {expanded && (
        <div className="divide-y divide-white/5 border-t border-white/5">
          {/* Shift summary row */}
          <div className="flex flex-wrap gap-6 bg-slate-800/30 px-4 py-3 text-xs text-slate-400">
            <span>
              <Clock className="mr-1 inline h-3 w-3" />
              {fmtTime(row.shiftStartedAt)} → {fmtTime(row.shiftEndedAt)}
            </span>
            <span className="text-slate-500">
              Idle: {fmtMin(row.idleMinutes)}
            </span>
            <span className="text-slate-500">
              {fmtMiles(row.totalDistanceM)} driven
            </span>
          </div>

          {row.appointments.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 italic">
              No geofence visits recorded for this shift
            </div>
          ) : (
            row.appointments.map((appt) => (
              <div key={appt.appointmentId} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {appt.customer}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-slate-400">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {appt.address}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-emerald-400">
                    ${appt.quotedTotal.toFixed(2)}
                  </span>
                </div>

                {/* Timestamp timeline */}
                <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                  <span>
                    <Navigation className="mr-0.5 inline h-3 w-3 text-blue-400" />
                    On My Way: {fmtTime(appt.onMyWayAt)}
                  </span>
                  <span>
                    <MapPin className="mr-0.5 inline h-3 w-3 text-emerald-400" />
                    Arrived (GPS):{' '}
                    {appt.hasGpsData ? fmtTime(appt.arrivedAt) : '—'}
                  </span>
                  <span>
                    <Clock className="mr-0.5 inline h-3 w-3" />
                    Completed: {fmtTime(appt.completedAt)}
                  </span>
                </div>

                {/* Time breakdown table */}
                <div className="grid grid-cols-3 divide-x divide-white/5 rounded-lg border border-white/5 bg-slate-800/40 text-xs">
                  <div className="p-2 text-center">
                    <p className="mb-0.5 text-slate-500">Travel (GPS)</p>
                    <p className="font-mono text-blue-400">
                      {appt.hasGpsData ? fmtMin(appt.gpsTravelMinutes) : '—'}
                    </p>
                  </div>
                  <div className="p-2 text-center">
                    <p className="mb-0.5 text-slate-500">On-Site (GPS)</p>
                    <p className="font-mono text-emerald-400">
                      {appt.hasGpsData ? fmtMin(appt.gpsOnSiteMinutes) : '—'}
                    </p>
                  </div>
                  <div className="p-2 text-center">
                    <p className="mb-0.5 text-slate-500">Current Method</p>
                    <p className="font-mono text-slate-300">
                      {fmtMin(appt.currentBillingMinutes)}
                    </p>
                  </div>
                </div>

                {/* Variance indicator */}
                {appt.hasGpsData && appt.varianceMinutes !== null && (
                  <div
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                      Math.abs(appt.varianceMinutes) <= 5
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : Math.abs(appt.varianceMinutes) <= 15
                          ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Variance: {appt.varianceMinutes > 0 ? '+' : ''}
                    {fmtMin(appt.varianceMinutes)} vs current method
                    <span className="ml-1 text-slate-500 italic">
                      (preview only — not used for billing)
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function TimesheetsView() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gps-timesheets', date],
    queryFn: () => fetchTimesheets(date),
    staleTime: 60_000,
  })

  const handleExport = useCallback(() => {
    if (data?.rows) exportCsv(data.rows, date)
  }, [data, date])

  function changeDate(offset: number) {
    const d = new Date(date)
    d.setDate(d.getDate() + offset)
    setDate(d.toISOString().split('T')[0])
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(-1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            ‹ Prev
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-1.5 text-sm text-white"
          />
          <button
            onClick={() => changeDate(1)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
          >
            Next ›
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5"
          >
            Refresh
          </button>
          <button
            onClick={handleExport}
            disabled={!data?.rows?.length}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Shadow mode notice */}
      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-300">
        <strong>Preview mode:</strong> GPS timing data shown here is for
        validation only. Billing and payroll still use the current method
        (On-My-Way → Completed) until you manually switch it over.
      </div>

      {/* Content */}
      {isLoading && (
        <div className="py-12 text-center text-slate-500">Loading…</div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error instanceof Error ? error.message : 'Failed to load timesheets'}
        </div>
      )}

      {!isLoading && !error && (
        <>
          {data?.rows?.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              No shifts found for {date}
            </div>
          ) : (
            <div className="space-y-3">
              {data?.rows?.map((row) => (
                <ShiftCard key={row.shiftId} row={row} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
