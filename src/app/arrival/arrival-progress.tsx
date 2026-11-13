'use client'

import { useEffect, useState } from 'react'
import type { CustomerArrival } from '@/lib/ops/customer-arrival'

const mountainTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver',
  hour: 'numeric',
  minute: '2-digit',
})

export default function ArrivalProgress() {
  const [trip, setTrip] = useState<CustomerArrival | null>(null)

  useEffect(() => {
    const token = window.location.hash.slice(1)
    if (!token) {
      const timer = setTimeout(() => setTrip({ status: 'ended' }), 0)
      return () => clearTimeout(timer)
    }

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const response = await fetch('/api/public/arrival', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        })
        const update: CustomerArrival = response.ok
          ? await response.json()
          : { status: 'waiting' }
        if (controller.signal.aborted) return
        setTrip(update)
        if (update.status === 'arrived' || update.status === 'ended') return
      } catch {
        if (controller.signal.aborted) return
        setTrip({ status: 'waiting' })
      }
      timer = setTimeout(refresh, 10_000)
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [])

  const step =
    trip?.status === 'arrived'
      ? 2
      : trip?.status === 'en_route' && trip.arrivingSoon
        ? 1
        : 0

  return (
    <main className="min-h-dvh bg-slate-950 px-5 py-20 text-slate-100">
      <section className="mx-auto max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 sm:p-8">
        <p className="mb-2 text-sm font-semibold text-emerald-300">
          Sasquatch Carpet Cleaning
        </p>
        <div aria-live="polite">
          {trip?.status === 'en_route' ? (
            <>
              <h1 className="text-lg font-semibold">Estimated arrival</h1>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                {mountainTime.formatRange(
                  new Date(trip.earliest),
                  new Date(trip.latest),
                )}
              </p>
              <p className="mt-2 text-sm text-slate-300">Mountain Time</p>
            </>
          ) : (
            <h1 className="text-2xl font-bold">
              {trip?.status === 'arrived'
                ? 'Your technician has arrived'
                : trip?.status === 'ended'
                  ? 'Arrival tracking has ended'
                  : trip
                    ? 'Live ETA temporarily unavailable'
                    : 'Checking arrival time…'}
            </h1>
          )}
          {trip && trip.status !== 'ended' && (
            <ol
              aria-label="Arrival progress"
              className="mt-8 grid grid-cols-3 gap-2"
            >
              {['On the way', 'Arriving soon', 'Arrived'].map(
                (label, index) => (
                  <li
                    key={label}
                    aria-current={index === step ? 'step' : undefined}
                    className={`border-t-4 pt-2 text-sm ${index <= step ? 'border-emerald-400 font-semibold text-white' : 'border-slate-600 text-slate-400'}`}
                  >
                    {label}
                  </li>
                ),
              )}
            </ol>
          )}
        </div>
      </section>
    </main>
  )
}
