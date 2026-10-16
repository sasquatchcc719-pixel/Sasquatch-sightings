'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MoonStar, RefreshCw, Snowflake } from 'lucide-react'
import type { TruckWeather } from '@/lib/tech/truck-weather'

const REFRESH_MS = 15 * 60_000

export function TruckWeatherCard() {
  const [weather, setWeather] = useState<TruckWeather | null>(null)
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const response = await fetch('/api/tech/truck-weather', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Forecast unavailable')
      const next: TruckWeather = await response.json()
      if (
        typeof next.lowF !== 'number' ||
        !Number.isFinite(next.lowF) ||
        !next.forecastUpdatedAt ||
        !Number.isFinite(Date.parse(next.forecastUpdatedAt))
      ) {
        throw new Error('Forecast unavailable')
      }
      if (id === requestId.current) setWeather(next)
    } catch {
      if (id === requestId.current) setWeather(null)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const requests = requestId
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(onVisible, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      requests.current++
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [refresh])

  const cold = weather?.cold ?? false
  const updated = weather?.forecastUpdatedAt
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(weather.forecastUpdatedAt))
    : null

  return (
    <section
      aria-label="Palmer Lake overnight weather"
      className={`overflow-hidden rounded-2xl border p-4 shadow-lg ${
        cold
          ? 'border-amber-300/40 bg-gradient-to-br from-amber-950/90 to-slate-950 text-amber-50 shadow-amber-950/20'
          : 'border-cyan-300/20 bg-gradient-to-br from-slate-900 to-cyan-950/80 text-slate-100 shadow-cyan-950/20'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <MoonStar className="h-4 w-4 text-cyan-200" />
          Palmer Lake
        </p>
        <button
          type="button"
          aria-label="Refresh Palmer Lake weather"
          disabled={loading}
          onClick={() => void refresh()}
          className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-5" role="status">
        <div className="shrink-0">
          <p className="text-[11px] font-medium tracking-wider text-slate-300 uppercase">
            Overnight low
          </p>
          <p className="mt-1 font-mono text-4xl font-bold tracking-tight">
            {weather?.lowF != null ? `${Math.round(weather.lowF)}°F` : '—'}
          </p>
        </div>
        <div className="min-w-0 border-l border-white/15 pl-5 text-sm">
          {cold ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-amber-200">
                <Snowflake className="h-4 w-4 shrink-0" />
                Protect the truck tonight
              </p>
              <p className="mt-1 leading-relaxed text-amber-50">
                Put a heater in the truck. Close and latch the back door.
              </p>
            </>
          ) : weather ? (
            <>
              <p className="font-semibold text-cyan-100">
                Tonight in Palmer Lake
              </p>
              <p className="mt-1 text-slate-300">
                Heater reminder at 33°F or colder. Close and latch the back door
                every day.
              </p>
            </>
          ) : loading ? (
            <p className="text-slate-300">Checking the overnight forecast…</p>
          ) : (
            <p className="text-amber-200">
              Forecast unavailable. Check the overnight low; at 33°F or colder,
              put a heater in the truck. Close and latch the back door.
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        National Weather Service{updated ? ` · Updated ${updated} MT` : ''} ·
        Refreshes every 15 min
      </p>
    </section>
  )
}
