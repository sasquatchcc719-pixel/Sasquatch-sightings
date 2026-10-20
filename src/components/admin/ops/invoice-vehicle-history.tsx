'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
const RouteMap = dynamic(() => import('../fleet-tracker-map'), { ssr: false })
const noSelection = () => {}
type Visit = {
  id: string
  tracker_name: string
  location_label: string
  arrived_at: string
  departed_at: string | null
}
type Trip = {
  id: string
  tracker_name: string
  origin_appointment_id: string | null
  destination_appointment_id: string | null
  origin_label: string
  destination_label: string | null
  departed_at: string
  arrived_at: string | null
  status: string
  observed_distance_m: number
  signal_gaps: number
  route_truncated: boolean
  route: { at: string; lat: number; lng: number; gap?: boolean }[]
}
function stamp(value: string | null) {
  return value
    ? new Date(value).toLocaleString('en-US', {
        timeZone: 'America/Denver',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not recorded'
}
function duration(start: string, end: string | null) {
  return end
    ? `${Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000))} min`
    : '—'
}
export function InvoiceVehicleHistory({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false)
  const [routeId, setRouteId] = useState<string | null>(null)
  const history = useQuery({
    queryKey: ['invoice-vehicle-history', invoiceId],
    enabled: open,
    refetchInterval: open ? 30000 : false,
    queryFn: async () => {
      const r = await fetch(
        `/api/admin/ops/invoices/${invoiceId}/vehicle-history`,
        { cache: 'no-store' },
      )
      if (!r.ok)
        throw new Error('Vehicle history could not load. Please try again.')
      return r.json() as Promise<{
        appointmentId?: string
        visits: Visit[]
        trips: Trip[]
      }>
    },
  })
  const route = history.data?.trips.find((t) => t.id === routeId)
  return (
    <details
      className="my-5 rounded-xl border border-sky-400/25 bg-sky-950/10 p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer font-semibold">
        Vehicle travel & visits{' '}
        <span className="ml-2 text-xs font-normal text-slate-500">
          Admin only
        </span>
      </summary>
      {open && (
        <div className="space-y-4 pt-3 text-sm">
          <p className="text-muted-foreground">
            Private GPS observations · Mountain Time. Arrival requires a
            60-second stop near the scheduled address; departure requires 30
            seconds outside it. Vehicle presence does not establish work time.
          </p>
          {history.isPending && <p>Loading vehicle history…</p>}
          {history.error && <p role="alert">{history.error.message}</p>}
          {history.data &&
            !history.data.visits.length &&
            !history.data.trips.length && (
              <p>
                No GPS travel or visits recorded for this job. Recording begins
                after the truck is configured and receives GPS; earlier test
                drives are excluded.
              </p>
            )}
          {history.data?.visits.map((v) => (
            <div key={v.id} className="rounded-lg border p-3">
              <p className="font-medium">{v.tracker_name} · GPS visit</p>
              <p>Arrived: {stamp(v.arrived_at)}</p>
              <p>Departed: {stamp(v.departed_at)}</p>
              <p>Time at location: {duration(v.arrived_at, v.departed_at)}</p>
            </div>
          ))}
          {history.data?.trips.map((t) => (
            <div key={t.id} className="rounded-lg border p-3">
              <p className="font-medium">
                {t.destination_appointment_id === history.data?.appointmentId
                  ? 'Incoming trip'
                  : 'Outgoing trip'}{' '}
                · {t.tracker_name}
              </p>
              <p className="mt-1 break-words">
                {t.origin_label} →{' '}
                {t.destination_label || 'Destination not recorded yet'}
              </p>
              <p>
                Departed: {stamp(t.departed_at)} · Arrived:{' '}
                {stamp(t.arrived_at)}
              </p>
              <p>
                Travel time: {duration(t.departed_at, t.arrived_at)} · Observed
                distance: {(t.observed_distance_m / 1609.344).toFixed(1)} mi
              </p>
              {(t.signal_gaps > 0 ||
                t.route_truncated ||
                t.status === 'incomplete') && (
                <p className="text-amber-600">
                  Incomplete GPS coverage
                  {t.signal_gaps > 0 ? ` · ${t.signal_gaps} signal gap(s)` : ''}
                  . Distance includes observed movement only.
                </p>
              )}
              {t.route.length > 1 && (
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-lg border px-3"
                  onClick={() => setRouteId(routeId === t.id ? null : t.id)}
                >
                  {routeId === t.id ? 'Close route' : 'View saved route'}
                </button>
              )}
            </div>
          ))}
          {route && (
            <RouteMap
              now={Date.parse(route.departed_at)}
              historyKey={route.id}
              trackers={[]}
              selectedId=""
              focusRequest={0}
              onSelect={noSelection}
              points={route.route.map((p) => ({
                recorded_at: p.at,
                latitude: p.lat,
                longitude: p.lng,
                speed_mps: null,
                bearing: null,
                break_before: p.gap,
              }))}
            />
          )}
        </div>
      )}
    </details>
  )
}
