'use client'

import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import type { BoxTruckStatus } from '@/app/api/tech/box-truck-status/route'
import { BOX_TRUCK_NAME } from '@/lib/truck-temperature'

const mountainTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
})

export function BoxTruckStatusCard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['tech-box-truck-status'],
    queryFn: async ({ signal }): Promise<BoxTruckStatus | null> => {
      const response = await fetch('/api/tech/box-truck-status', {
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error('Truck status unavailable')
      return response.json()
    },
    refetchInterval: 10_000,
    retry: false,
  })
  if (data === null && !isError) return null

  const trip = isError ? null : data?.arrival
  const status = isError
    ? 'Truck status unavailable'
    : (data?.vehicleStatus ?? 'Checking tracker…')

  return (
    <section
      aria-label={BOX_TRUCK_NAME}
      className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-2xl border border-emerald-300/25 bg-slate-900 px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-400/10 p-2.5">
          <Truck aria-hidden="true" className="size-5 text-emerald-300" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{BOX_TRUCK_NAME}</h2>
          <p className="mt-0.5 text-xs text-slate-300">{status}</p>
        </div>
      </div>
      <div className="min-w-0" role="status">
        {trip?.status === 'en_route' ? (
          <>
            <p className="text-xs text-slate-300">
              Customer ETA ·{' '}
              {trip.arrivingSoon ? 'Arriving soon' : 'On the way'}
            </p>
            <p className="text-xl font-semibold text-emerald-200 tabular-nums">
              {mountainTime.formatRange(
                new Date(trip.earliest),
                new Date(trip.latest),
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-300">
            {isError || trip?.status === 'waiting'
              ? 'Live ETA temporarily unavailable'
              : trip?.status === 'arrived'
                ? 'Customer view shows Arrived'
                : isPending
                  ? 'Checking customer ETA…'
                  : 'No active customer ETA'}
          </p>
        )}
      </div>
    </section>
  )
}
