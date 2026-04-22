'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { RefreshCw, Navigation, Clock } from 'lucide-react'

interface TechPosition {
  shiftId: string
  userId: string
  displayName: string
  role: string
  shiftStartedAt: string
  lat: number
  lng: number
  accuracyM: number | null
  speedMps: number | null
  segmentType: 'travel' | 'on_site' | 'idle' | 'unknown'
  appointmentId: string | null
  lastSeenAt: string
}

function segmentColor(type: TechPosition['segmentType']): string {
  if (type === 'on_site') return '#10b981' // emerald
  if (type === 'travel') return '#3b82f6' // blue
  return '#64748b' // slate / idle
}

function segmentLabel(type: TechPosition['segmentType']): string {
  if (type === 'on_site') return 'On-Site'
  if (type === 'travel') return 'Traveling'
  return 'Idle'
}

function formatTimeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  return `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`
}

function formatShiftDuration(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function DispatchMap() {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())

  const [techs, setTechs] = useState<TechPosition[]>([])
  const [selected, setSelected] = useState<TechPosition | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ops/gps/live', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to fetch live positions')
      const data = await res.json()
      setTechs(data.techs ?? [])
      setLastUpdated(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Mapbox token not configured (NEXT_PUBLIC_MAPBOX_TOKEN)')
      setLoading(false)
      return
    }

    mapboxgl.accessToken = token

    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-104.82, 38.95], // Colorado Springs / Tri-Lakes
      zoom: 10,
    })

    mapRef.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

    mapRef.current.on('load', () => {
      void fetchLive()
    })
  }, [fetchLive])

  // Update markers when tech positions change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Remove stale markers
    for (const [userId, marker] of markersRef.current.entries()) {
      if (!techs.find((t) => t.userId === userId)) {
        marker.remove()
        markersRef.current.delete(userId)
      }
    }

    // Add / update markers
    for (const tech of techs) {
      const color = segmentColor(tech.segmentType)
      const existing = markersRef.current.get(tech.userId)

      if (existing) {
        existing.setLngLat([tech.lng, tech.lat])
        // Update color via DOM
        const el = existing.getElement()
        el.style.backgroundColor = color
      } else {
        const el = document.createElement('div')
        el.style.cssText = `
          width: 36px; height: 36px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.8);
          background-color: ${color};
          display: flex; align-items: center; justify-content: center;
          color: white; font-size: 11px; font-weight: 700;
          cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          transition: background-color 0.3s;
        `
        el.textContent = tech.displayName.slice(0, 2).toUpperCase()
        el.title = tech.displayName

        el.addEventListener('click', () => {
          setSelected(tech)
          mapRef.current?.flyTo({
            center: [tech.lng, tech.lat],
            zoom: 14,
            duration: 1000,
          })
        })

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([tech.lng, tech.lat])
          .addTo(map)

        markersRef.current.set(tech.userId, marker)
      }
    }

    // Update selected if still visible
    if (selected) {
      const updated = techs.find((t) => t.userId === selected.userId)
      setSelected(updated ?? null)
    }
  }, [techs, selected])

  // Auto-refresh every 20s
  useEffect(() => {
    const interval = setInterval(fetchLive, 20_000)
    return () => clearInterval(interval)
  }, [fetchLive])

  return (
    <div className="relative h-[60vh] min-h-[400px] overflow-hidden rounded-2xl border border-white/10">
      {/* Map container */}
      <div ref={mapContainer} className="h-full w-full" />

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
          <div className="text-sm text-slate-400">Loading live positions…</div>
        </div>
      )}

      {/* Error overlay */}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80">
          <div className="text-center">
            <p className="mb-3 text-sm text-red-400">{error}</p>
            <button
              onClick={fetchLive}
              className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-600"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* No active techs */}
      {!loading && !error && techs.length === 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-900/90 px-4 py-2 text-sm text-slate-400">
          No active shifts right now
        </div>
      )}

      {/* Refresh indicator */}
      <div className="absolute top-3 right-14 flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2 py-1 text-[10px] text-slate-400">
        <RefreshCw className="h-3 w-3" />
        {lastUpdated
          ? `Updated ${formatTimeAgo(lastUpdated.toISOString())}`
          : 'Loading…'}
      </div>

      {/* Selected tech panel */}
      {selected && (
        <div
          className="absolute bottom-4 left-4 w-64 rounded-2xl border border-white/10 p-4 text-sm"
          style={{
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="font-semibold text-white">{selected.displayName}</p>
              <p className="text-xs text-slate-400 capitalize">
                {selected.role}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: segmentColor(selected.segmentType) }}
              />
              <span className="text-slate-200">
                {segmentLabel(selected.segmentType)}
              </span>
            </div>

            <div className="flex items-center gap-2 text-slate-400">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>Shift: {formatShiftDuration(selected.shiftStartedAt)}</span>
            </div>

            <div className="flex items-center gap-2 text-slate-400">
              <Navigation className="h-3.5 w-3.5 shrink-0" />
              <span>
                {selected.speedMps != null
                  ? `${Math.round(selected.speedMps * 2.237)} mph`
                  : 'Speed unknown'}
              </span>
            </div>

            <p className="text-[10px] text-slate-600">
              Last seen: {formatTimeAgo(selected.lastSeenAt)}
            </p>
            {selected.accuracyM && (
              <p className="text-[10px] text-slate-600">
                GPS accuracy: ±{Math.round(selected.accuracyM)}m
              </p>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        className="absolute right-4 bottom-4 space-y-1 rounded-xl border border-white/10 px-3 py-2 text-[10px] text-slate-400"
        style={{ background: 'rgba(15, 23, 42, 0.85)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          On-Site
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Traveling
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          Idle
        </div>
      </div>
    </div>
  )
}
