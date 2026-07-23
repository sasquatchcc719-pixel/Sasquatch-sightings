'use client'

/**
 * Shared canvassing coverage map. Every completed walk renders as a shaded
 * corridor (wide translucent line ≈ door-hanger reach) in the walker's color
 * with a "date — name" label along it, so neither person re-canvasses a
 * neighborhood the other already hit. Date-range filtering via `days`.
 */

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

export type CanvassSessionRow = {
  id: string
  user_id: string
  user_name: string
  color: string
  started_at: string
  ended_at: string | null
  point_count: number
  distance_m: number | null
}

const SOURCE_ID = 'canvass-coverage'

export function CanvassCoverageMap({
  days,
  refreshKey = 0,
  onSessions,
  className,
}: {
  days: number
  refreshKey?: number
  onSessions?: (sessions: CanvassSessionRow[]) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Mapbox token not configured (NEXT_PUBLIC_MAPBOX_TOKEN)')
      return
    }
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-104.87, 39.09], // Palmer Lake / Monument
      zoom: 12,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      // Wide translucent corridor — the "highlighted area" of the walk.
      map.addLayer({
        id: 'canvass-corridor',
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.35,
          'line-width': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            12,
            6,
            15,
            26,
            17,
            70,
          ],
        },
      })
      // Thin solid centerline for crisp route reading.
      map.addLayer({
        id: 'canvass-centerline',
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-opacity': 0.9,
          'line-width': 2,
        },
      })
      // "Jun 12, 2026 — David" along the route.
      map.addLayer({
        id: 'canvass-labels',
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      })
      setMapReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    fetch(`/api/field/canvass/coverage?days=${days}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error)
          return
        }
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource
        source?.setData(data.geojson)
        onSessions?.(data.sessions ?? [])
        const coords: [number, number][] = (
          data.geojson.features as Array<{
            geometry: { coordinates: [number, number][] }
          }>
        ).flatMap((f) => f.geometry.coordinates)
        if (coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0]),
          )
          map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
        }
      })
      .catch(() => setError('Failed to load coverage'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, days, refreshKey])

  return (
    <div className={className ?? 'relative h-[60vh] w-full rounded-xl'}>
      <div ref={containerRef} className="h-full w-full rounded-xl" />
      {error ? (
        <p className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
