'use client'

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { estimatedDriveTime, type DispatchJob } from '@/lib/ops/daily-dispatch'
import type { PlannedDriveLeg } from '@/lib/ops/planned-driving'

const NO_JOBS: DispatchJob[] = []
const NO_DRIVES: PlannedDriveLeg[] = []
import {
  FleetTracker,
  TrackerHistoryPoint,
  trackerHistoryLines,
  trackerStatus,
} from '@/lib/fleet-tracking'

export default function FleetTrackerMap({
  now,
  historyKey,
  trackers,
  selectedId,
  points,
  focusRequest,
  onSelect,
  jobs = NO_JOBS,
  selectedJobId = '',
  onSelectJob,
  plannedDrives = NO_DRIVES,
}: {
  now: number
  historyKey: string
  trackers: FleetTracker[]
  selectedId: string
  points: TrackerHistoryPoint[]
  focusRequest: number
  onSelect: (id: string) => void
  jobs?: DispatchJob[]
  selectedJobId?: string
  onSelectJob?: (id: string) => void
  plannedDrives?: PlannedDriveLeg[]
}) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markers = useRef(new Map<string, mapboxgl.Marker>())
  const jobMarkers = useRef(new Map<string, mapboxgl.Marker>())
  const framedJobs = useRef('')
  const onJobRef = useRef(onSelectJob)
  onJobRef.current = onSelectJob
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const centered = useRef(false)
  const framedHistory = useRef('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!container.current) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token) {
      setError('Map is unavailable. Device status will continue updating.')
      return
    }
    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: container.current,
        accessToken: token,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [-104.86, 39.12],
        zoom: 10,
      })
    } catch {
      setError(
        'This browser cannot display the map. Device status will continue updating.',
      )
      return
    }
    const activeMarkers = markers.current
    const activeJobs = jobMarkers.current
    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(container.current)
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.on('load', () => {
      map.addSource('planned-driving', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addSource('planned-driving-labels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'planned-driving-line',
        type: 'line',
        source: 'planned-driving',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': 4,
          'line-dasharray': [2, 1],
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'planned-driving-arrows',
        type: 'symbol',
        source: 'planned-driving',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 100,
          'text-field': '›',
          'text-size': 28,
          'text-keep-upright': false,
        },
        paint: {
          'text-color': '#bae6fd',
          'text-halo-color': '#082f49',
          'text-halo-width': 2,
        },
      })
      map.addLayer({
        id: 'planned-driving-labels',
        type: 'symbol',
        source: 'planned-driving-labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-allow-overlap': false,
          'text-padding': 8,
        },
        paint: {
          'text-color': '#e0f2fe',
          'text-halo-color': '#082f49',
          'text-halo-width': 3,
        },
      })
      map.addSource('vehicle-history', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'vehicle-history-line',
        type: 'line',
        source: 'vehicle-history',
        paint: {
          'line-color': '#34d399',
          'line-width': 4,
          'line-opacity': 0.8,
        },
      })
      setLoaded(true)
    })
    map.on('error', () =>
      setError('Map tiles could not load. Check your internet connection.'),
    )
    map.on('idle', () => {
      if (map.isStyleLoaded()) setError('')
    })
    return () => {
      resizeObserver.disconnect()
      for (const marker of activeMarkers.values()) marker.remove()
      activeMarkers.clear()
      for (const marker of activeJobs.values()) marker.remove()
      activeJobs.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const legs = plannedDrives.filter(
      (leg) => leg.seconds !== null && leg.coordinates.length > 1,
    )
    const source = map.getSource('planned-driving') as mapboxgl.GeoJSONSource
    source?.setData({
      type: 'FeatureCollection',
      features: legs.map((leg) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: leg.coordinates },
      })),
    })
    const labels = map.getSource(
      'planned-driving-labels',
    ) as mapboxgl.GeoJSONSource
    labels?.setData({
      type: 'FeatureCollection',
      features: legs.map((leg) => ({
        type: 'Feature' as const,
        properties: {
          label: `${jobs.findIndex((job) => job.id === leg.fromJobId) + 1} → ${jobs.findIndex((job) => job.id === leg.toJobId) + 1} · ${estimatedDriveTime(leg.seconds!)} est.`,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: leg.coordinates[Math.floor(leg.coordinates.length / 2)],
        },
      })),
    })
  }, [plannedDrives, jobs, loaded])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const animations: number[] = []
    const positioned = trackers.filter(
      (tracker) => tracker.latitude !== null && tracker.longitude !== null,
    )
    for (const [id, marker] of markers.current) {
      if (!positioned.some((tracker) => tracker.id === id)) {
        marker.remove()
        markers.current.delete(id)
      }
    }
    for (const tracker of positioned) {
      let marker = markers.current.get(tracker.id)
      if (!marker) {
        const element = document.createElement('button')
        element.type = 'button'
        element.style.cssText =
          'width:44px;height:44px;border:3px solid white;border-radius:50%;color:white;font:700 12px system-ui;box-shadow:0 0 24px #10b98155;cursor:pointer'
        element.addEventListener('click', () => onSelectRef.current(tracker.id))
        marker = new mapboxgl.Marker({ element })
          .setLngLat([tracker.longitude!, tracker.latitude!])
          .addTo(map)
        markers.current.set(tracker.id, marker)
      }
      const element = marker.getElement()
      element.textContent = tracker.name.slice(0, 2).toUpperCase()
      const from = marker.getLngLat()
      const target = [tracker.longitude!, tracker.latitude!] as const
      const start = performance.now()
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches
        ? 0
        : 1200
      const animate = (time: number) => {
        const progress = duration ? Math.min(1, (time - start) / duration) : 1
        marker!.setLngLat([
          from.lng + (target[0] - from.lng) * progress,
          from.lat + (target[1] - from.lat) * progress,
        ])
        if (progress < 1) animations.push(requestAnimationFrame(animate))
      }
      animations.push(requestAnimationFrame(animate))
    }
    if (
      !centered.current &&
      positioned.length &&
      !jobs.some((job) => job.location) &&
      !points.length
    ) {
      map.jumpTo({
        center: [positioned[0].longitude!, positioned[0].latitude!],
        zoom: 15,
      })
      centered.current = true
    }
    return () => animations.forEach(cancelAnimationFrame)
  }, [trackers, loaded, jobs, points.length])

  useEffect(() => {
    for (const tracker of trackers) {
      const element = markers.current.get(tracker.id)?.getElement()
      if (!element) continue
      const status = trackerStatus(tracker, now)
      element.style.background =
        status === 'Moving' || status === 'Parked' ? '#059669' : '#64748b'
      element.style.outline =
        tracker.id === selectedId ? '3px solid #67e8f9' : 'none'
      element.setAttribute('aria-label', `${tracker.name}: ${status}`)
      element.title = `${tracker.name} · ${status}`
    }
  }, [trackers, selectedId, loaded, now])

  useEffect(() => {
    const tracker = trackers.find((item) => item.id === selectedId)
    if (tracker?.latitude !== null && tracker?.longitude !== null && tracker)
      mapRef.current?.flyTo({
        center: [tracker.longitude, tracker.latitude],
        zoom: 15,
        duration: 600,
      })
    // Location refreshes move the marker without repeatedly grabbing the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    for (const marker of jobMarkers.current.values()) marker.remove()
    jobMarkers.current.clear()
    const bounds = new mapboxgl.LngLatBounds()
    jobs.forEach((job, index) => {
      if (!job.location) return
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = String(index + 1)
      element.style.cssText =
        'width:36px;height:36px;border:2px solid white;border-radius:10px;background:#0284c7;color:white;font:700 14px system-ui;box-shadow:0 3px 16px #0008;cursor:pointer'
      if (job.status === 'completed') element.style.background = '#059669'
      if (job.id === selectedJobId) element.style.outline = '3px solid #67e8f9'
      element.title = `${index + 1}. ${job.name} · ${job.start.slice(0, 5)} · ${job.staffName}`
      element.setAttribute('aria-label', element.title)
      element.addEventListener('click', () => onJobRef.current?.(job.id))
      jobMarkers.current.set(
        job.id,
        new mapboxgl.Marker({ element })
          .setLngLat([job.location.lng, job.location.lat])
          .addTo(map),
      )
      bounds.extend([job.location.lng, job.location.lat])
    })
    for (const leg of plannedDrives)
      for (const coordinate of leg.coordinates) bounds.extend(coordinate)
    const frameKey =
      historyKey +
      jobs
        .map((job) => `${job.id}:${job.location?.lat}:${job.location?.lng}`)
        .join('|') +
      plannedDrives
        .map((leg) => `${leg.fromJobId}:${leg.toJobId}:${leg.meters}`)
        .join('|')
    if (
      !points.length &&
      !bounds.isEmpty() &&
      framedJobs.current !== frameKey
    ) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
      framedJobs.current = frameKey
    }
  }, [jobs, loaded, selectedJobId, historyKey, points.length, plannedDrives])

  useEffect(() => {
    const job = jobs.find((item) => item.id === selectedJobId)
    if (job?.location && loaded)
      mapRef.current?.flyTo({
        center: [job.location.lng, job.location.lat],
        zoom: 15,
        duration: 500,
      })
    // New live positions must not pull focus away from the selected job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, loaded])

  useEffect(() => {
    const source = mapRef.current?.getSource('vehicle-history') as
      | mapboxgl.GeoJSONSource
      | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: trackerHistoryLines(points).map((coordinates) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      })),
    })
    if (!points.length) framedHistory.current = ''
    if (loaded && points.length && framedHistory.current !== historyKey) {
      const bounds = new mapboxgl.LngLatBounds()
      for (const point of points)
        bounds.extend([point.longitude, point.latitude])
      mapRef.current?.fitBounds(bounds, {
        padding: 60,
        maxZoom: 16,
        duration: 600,
      })
      framedHistory.current = historyKey
    }
  }, [points, loaded, historyKey])

  return (
    <div className="relative h-[55vh] min-h-[340px] w-full">
      <div ref={container} className="h-full w-full" />
      {error && (
        <div
          role="alert"
          className="absolute top-3 left-3 max-w-[75%] rounded-lg bg-slate-950/95 p-3 text-sm text-amber-200"
        >
          {error}
        </div>
      )}
    </div>
  )
}
