'use client'

/**
 * Shared canvassing coverage map. Each saved walk renders as a shaded
 * corridor (wide translucent line ≈ door-hanger reach) colored by age
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
  status: string
  has_route: boolean
  point_count: number
  distance_m: number | null
  gps_distance_m: number
  coverage_distance_m: number
  gap_distance_m: number
  gap_count: number
}

const SOURCE_ID = 'canvass-coverage'
const RECORDED_SOURCE_ID = 'canvass-recorded'
const EMPTY_TRACK: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

function miles(m: number) {
  return `${(m / 1609.344).toFixed(2)} mi`
}

function trackDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type CoverageFeature = {
  geometry: { coordinates: [number, number][][] }
  properties: { sessionId: string }
}

export function CanvassCoverageMap({
  days = 0,
  refreshKey = 0,
  onSessions,
  focusSessionId,
  onClearFocus,
  className,
}: {
  days?: number
  refreshKey?: number
  onSessions?: (sessions: CanvassSessionRow[]) => void
  /** Zoom to and highlight one walk; tapping a row in the session list. */
  focusSessionId?: string | null
  onClearFocus?: () => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const featuresRef = useRef<CoverageFeature[]>([])
  const focusRef = useRef<string | null>(null)
  const framedRef = useRef<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverageRevision, setCoverageRevision] = useState(0)
  const [inspection, setInspection] = useState<CanvassSessionRow | null>(null)
  const [inspectionError, setInspectionError] = useState<string | null>(null)

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
      map.addSource(RECORDED_SOURCE_ID, { type: 'geojson', data: EMPTY_TRACK })
      map.addLayer(
        {
          id: 'canvass-recorded-connections',
          type: 'line',
          source: RECORDED_SOURCE_ID,
          filter: ['==', ['get', 'kind'], 'connections'],
          paint: {
            'line-color': '#f59e0b',
            'line-width': 2,
            'line-dasharray': [2, 2],
          },
        },
        'canvass-centerline',
      )
      map.addLayer({
        id: 'canvass-recorded-samples',
        type: 'circle',
        source: RECORDED_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'samples'],
        paint: { 'circle-color': '#fbbf24', 'circle-radius': 2.5 },
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
    const controller = new AbortController()
    let loading = false
    let fitCoverage = true
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const response = await fetch(
          `/api/field/canvass/coverage?days=${days}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        )
        const data = await response.json()
        if (!response.ok || data.error) {
          throw new Error(data.error ?? 'Failed to load coverage')
        }
        if (controller.signal.aborted) return
        setError(null)
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource
        source?.setData(data.geojson)
        onSessions?.(data.sessions ?? [])
        featuresRef.current = (data.geojson.features ?? []) as CoverageFeature[]
        setCoverageRevision((revision) => revision + 1)
        // MultiLineString: coordinates are segments of points, so flatten one
        // extra level before computing bounds.
        const coords = featuresRef.current.flatMap((f) =>
          f.geometry.coordinates.flat(),
        )
        if (fitCoverage && !focusRef.current && coords.length > 1) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0]),
          )
          map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
        }
        if (coords.length > 1) fitCoverage = false
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Failed to load coverage',
          )
        }
      } finally {
        loading = false
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, days, refreshKey])

  // Tapping a row in the session list: fly to that walk and fade the rest so
  // it's obvious which one you're looking at.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    if (!map) return
    const previousFocus = focusRef.current
    focusRef.current = focusSessionId ?? null
    if (previousFocus !== focusRef.current) framedRef.current = null

    const dimmed = focusSessionId
      ? ([
          'case',
          ['==', ['get', 'sessionId'], focusSessionId],
          0.45,
          0.06,
        ] as unknown as mapboxgl.Expression)
      : 0.35
    const lineDim = focusSessionId
      ? ([
          'case',
          ['==', ['get', 'sessionId'], focusSessionId],
          1,
          0.15,
        ] as unknown as mapboxgl.Expression)
      : 0.9
    if (map.getLayer('canvass-corridor')) {
      map.setPaintProperty('canvass-corridor', 'line-opacity', dimmed)
    }
    if (map.getLayer('canvass-centerline')) {
      map.setPaintProperty('canvass-centerline', 'line-opacity', lineDim)
    }

    const recordedSource = map.getSource(
      RECORDED_SOURCE_ID,
    ) as mapboxgl.GeoJSONSource
    if (!focusSessionId) {
      if (previousFocus) {
        recordedSource?.setData(EMPTY_TRACK)
        const coords = featuresRef.current.flatMap((f) =>
          f.geometry.coordinates.flat(),
        )
        if (coords.length) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0]),
          )
          map.fitBounds(bounds, { padding: 60, maxZoom: 15 })
        }
      }
      setInspection(null)
      setInspectionError(null)
      return
    }
    if (previousFocus !== focusSessionId) {
      recordedSource?.setData(EMPTY_TRACK)
      setInspection(null)
    }
    setInspectionError(null)
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(
          `/api/field/canvass/coverage?sessionId=${encodeURIComponent(focusSessionId)}`,
          { cache: 'no-store', signal: controller.signal },
        )
        const data = await response.json()
        if (!response.ok || data.error)
          throw new Error(data.error ?? 'Failed to load selected track')
        if (controller.signal.aborted) return
        recordedSource?.setData(data.recorded_geojson ?? EMPTY_TRACK)
        setInspection(data.sessions[0] ?? null)
        const coords: [number, number][] =
          data.recorded_geojson?.features.find(
            (f: { properties: { kind: string } }) =>
              f.properties.kind === 'samples',
          )?.geometry.coordinates ?? []
        if (coords.length && framedRef.current !== focusSessionId) {
          const bounds = coords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(coords[0], coords[0]),
          )
          map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 800 })
          framedRef.current = focusSessionId
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setInspectionError(
            err instanceof Error
              ? err.message
              : 'Failed to load selected track',
          )
      }
    })()
    return () => controller.abort()
  }, [focusSessionId, mapReady, refreshKey, coverageRevision])

  return (
    <>
      <div className={className ?? 'relative h-[60vh] w-full rounded-xl'}>
        <div ref={containerRef} className="h-full w-full rounded-xl" />
        <div className="absolute top-2 left-2 rounded-lg bg-slate-950/90 px-3 py-2 text-xs text-slate-200 shadow-lg">
          <p className="mb-1 font-medium">Coverage age · all staff</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" />
              Under 6 months
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-500" />
              6–12 months
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />
              1 year or older
            </span>
          </div>
        </div>
        {error ? (
          <p className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/70 px-3 py-1 text-xs text-red-400">
            {error}
          </p>
        ) : null}
      </div>
      {focusSessionId ? (
        <section
          aria-label="Selected track"
          className="mt-3 space-y-3 rounded-xl border border-amber-500/30 bg-slate-950 p-4 text-slate-200"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                Selected track{inspection ? ` · ${inspection.user_name}` : ''}
              </h2>
              {inspection ? (
                <p className="mt-1 text-xs text-slate-400">
                  {trackDate(inspection.started_at)} →{' '}
                  {inspection.ended_at
                    ? trackDate(inspection.ended_at)
                    : 'In progress'}{' '}
                  · Mountain Time
                </p>
              ) : null}
            </div>
            {onClearFocus ? (
              <button
                type="button"
                onClick={onClearFocus}
                className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs"
              >
                Show all coverage
              </button>
            ) : null}
          </div>
          {inspectionError ? (
            <p role="alert" className="text-sm text-red-400">
              {inspectionError}
            </p>
          ) : inspection ? (
            <>
              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-slate-400">GPS total</dt>
                  <dd className="mt-1 text-base font-semibold">
                    {miles(inspection.gps_distance_m)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Mapped coverage</dt>
                  <dd className="mt-1 text-base font-semibold">
                    {miles(inspection.coverage_distance_m)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Excluded connections</dt>
                  <dd className="mt-1 text-base font-semibold text-amber-400">
                    {miles(inspection.gap_distance_m)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-slate-400">
                Amber dots are saved GPS samples; dashed lines connect them in
                recorded order. Travel between samples is unknown.{' '}
                {inspection.gap_count} connection
                {inspection.gap_count === 1 ? '' : 's'} excluded from coverage
                because of distance or speed.
              </p>
              {inspection.point_count === 0 ? (
                <p className="text-sm text-amber-400">
                  No GPS samples were saved for this walk.
                </p>
              ) : null}
            </>
          ) : (
            <p role="status" className="text-sm text-slate-400">
              Loading selected track…
            </p>
          )}
        </section>
      ) : null}
    </>
  )
}
