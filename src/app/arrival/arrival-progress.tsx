'use client'

import Image from 'next/image'
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
    <main className="min-h-dvh bg-slate-950 px-5 py-8 text-slate-100 sm:py-16">
      <section className="mx-auto max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 sm:p-8">
        <Image
          src="/tap/share-card.jpg"
          alt="Sasquatch Carpet Cleaning"
          width={1200}
          height={630}
          sizes="(max-width: 450px) calc(100vw - 90px), 382px"
          className="mb-6 h-auto w-full rounded-xl"
        />
        {trip?.technician && (
          <div className="mb-5 flex items-center gap-3">
            {trip.technician.photoUrl ? (
              <Image
                src={trip.technician.photoUrl}
                alt=""
                width={44}
                height={44}
                className="size-11 shrink-0 rounded-full border border-slate-600 object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-800 font-semibold"
              >
                {trip.technician.firstName[0]?.toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-xs text-slate-300">Your technician</p>
              <p className="font-semibold break-words">
                {trip.technician.firstName}
              </p>
            </div>
          </div>
        )}
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
            <div className="mt-5">
              <div aria-hidden="true" className="relative h-11">
                <div className="absolute inset-x-0 bottom-0 h-1.5 overflow-hidden rounded-full bg-slate-600">
                  <div
                    className="h-full rounded-full bg-emerald-400 motion-safe:transition-[width] motion-safe:duration-700"
                    style={{ width: `${[15, 50, 100][step]}%` }}
                  />
                </div>
                <div className="absolute inset-x-8 bottom-1">
                  <Image
                    src="/arrival/sasquatch-van.webp"
                    alt=""
                    width={256}
                    height={113}
                    sizes="64px"
                    className="absolute bottom-0 h-auto w-16 -translate-x-1/2 motion-safe:transition-[left] motion-safe:duration-700 motion-safe:ease-in-out"
                    style={{ left: `${step * 50}%` }}
                  />
                </div>
              </div>
              <ol
                aria-label="Arrival progress"
                className="mt-3 grid grid-cols-3 gap-2 text-center"
              >
                {['On the way', 'Arriving soon', 'Arrived'].map(
                  (label, index) => (
                    <li
                      key={label}
                      aria-current={index === step ? 'step' : undefined}
                      className={`text-sm ${index <= step ? 'font-semibold text-white' : 'text-slate-400'}`}
                    >
                      {label}
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
