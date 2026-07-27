'use client'

/**
 * Canvassing GPS tracker — Start/Stop door-hanger route recording.
 * Simplified sibling of useGpsTracker: no geofencing, no shifts, no payroll.
 * Points buffer locally (localStorage-backed, survives a reload) and flush
 * to the server every 30s. A wake lock keeps the screen alive while walking.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { haversineDistance } from '@/lib/gps/haversine'
import { releaseWakeLock, requestWakeLock } from '@/lib/gps/wakeLock'

const FLUSH_INTERVAL_MS = 30_000
const MIN_MOVE_METERS = 6
const STASH_KEY = 'canvass-point-stash'

type PendingPoint = {
  lat: number
  lng: number
  accuracyM: number | null
  speedMps: number | null
  recordedAt: string
}

export interface CanvassTrackerValue {
  isTracking: boolean
  sessionId: string | null
  startedAt: string | null
  elapsedMs: number
  distanceM: number
  pointCount: number
  accuracy: number | null
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<{ distanceM: number; pointCount: number } | null>
}

function loadStash(): { sessionId: string; points: PendingPoint[] } | null {
  try {
    const raw = localStorage.getItem(STASH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveStash(sessionId: string, points: PendingPoint[]): void {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify({ sessionId, points }))
  } catch {
    // storage full/unavailable — points stay in memory only
  }
}

export function useCanvassTracker(): CanvassTrackerValue {
  const [isTracking, setIsTracking] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [distanceM, setDistanceM] = useState(0)
  const [pointCount, setPointCount] = useState(0)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bufferRef = useRef<PendingPoint[]>([])
  const lastPointRef = useRef<{ lat: number; lng: number } | null>(null)
  const sessionRef = useRef<string | null>(null)

  const flush = useCallback(async () => {
    const sid = sessionRef.current
    if (!sid || bufferRef.current.length === 0) return
    const batch = bufferRef.current
    bufferRef.current = []
    try {
      const res = await fetch('/api/field/canvass/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, points: batch }),
      })
      // The server permanently refuses these (session not ours / long closed).
      // Retrying forever would wedge the buffer and block every later point,
      // so drop them and surface it rather than failing silently.
      if (res.status === 403 || res.status === 409) {
        setError('Tracking was interrupted — tap Stop, then Start again.')
        saveStash(sid, bufferRef.current)
        return
      }
      if (!res.ok) throw new Error(`flush failed: ${res.status}`)
      saveStash(sid, bufferRef.current)
    } catch {
      // Offline or server hiccup — put the batch back and stash it so a
      // page reload doesn't lose the walk.
      bufferRef.current = [...batch, ...bufferRef.current]
      saveStash(sid, bufferRef.current)
    }
  }, [])

  const handlePosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy: acc, speed } = pos.coords
    setAccuracy(acc ?? null)
    // Ignore junk fixes and jitter while standing at a door.
    if (acc != null && acc > 50) return
    const last = lastPointRef.current
    if (last) {
      const moved = haversineDistance(last.lat, last.lng, latitude, longitude)
      if (moved < MIN_MOVE_METERS) return
      setDistanceM((d) => d + moved)
    }
    lastPointRef.current = { lat: latitude, lng: longitude }
    bufferRef.current.push({
      lat: latitude,
      lng: longitude,
      accuracyM: acc ?? null,
      speedMps: speed ?? null,
      recordedAt: new Date().toISOString(),
    })
    setPointCount((c) => c + 1)
    if (sessionRef.current) saveStash(sessionRef.current, bufferRef.current)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!('geolocation' in navigator)) {
      setError('GPS not available on this device')
      return
    }
    try {
      const res = await fetch('/api/field/canvass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to start')

      sessionRef.current = data.session.id
      setSessionId(data.session.id)
      setStartedAt(data.session.started_at)
      setIsTracking(true)
      setDistanceM(0)
      setPointCount(0)
      setElapsedMs(0)
      bufferRef.current = []
      lastPointRef.current = null

      await requestWakeLock()
      watchIdRef.current = navigator.geolocation.watchPosition(
        handlePosition,
        (err) => setError(err.message),
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      )
      flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS)
      const startMs = Date.parse(data.session.started_at)
      tickTimerRef.current = setInterval(
        () => setElapsedMs(Date.now() - startMs),
        1_000,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }, [flush, handlePosition])

  const stop = useCallback(async () => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (tickTimerRef.current) clearInterval(tickTimerRef.current)
    releaseWakeLock()

    await flush()
    try {
      const res = await fetch('/api/field/canvass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      const data = await res.json()
      localStorage.removeItem(STASH_KEY)
      setIsTracking(false)
      setSessionId(null)
      sessionRef.current = null
      if (!res.ok) {
        setError(data.error ?? 'Failed to stop')
        return null
      }
      return {
        distanceM: Number(data.session?.distance_m ?? 0),
        pointCount: Number(data.session?.point_count ?? 0),
      }
    } catch (err) {
      setIsTracking(false)
      setError(err instanceof Error ? err.message : 'Failed to stop')
      return null
    }
  }, [flush])

  // Resume after a reload mid-walk: reattach to the server's active session
  // and recover any stashed unflushed points.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/field/canvass', { cache: 'no-store' })
        const data = await res.json()
        if (cancelled || !data.session) return
        const stash = loadStash()
        if (stash && stash.sessionId === data.session.id) {
          bufferRef.current = stash.points
        }
        sessionRef.current = data.session.id
        setSessionId(data.session.id)
        setStartedAt(data.session.started_at)
        setIsTracking(true)
        await requestWakeLock()
        watchIdRef.current = navigator.geolocation.watchPosition(
          handlePosition,
          (err) => setError(err.message),
          { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
        )
        flushTimerRef.current = setInterval(flush, FLUSH_INTERVAL_MS)
        const startMs = Date.parse(data.session.started_at)
        tickTimerRef.current = setInterval(
          () => setElapsedMs(Date.now() - startMs),
          1_000,
        )
      } catch {
        // not signed in or offline — the start button still works later
      }
    })()
    return () => {
      cancelled = true
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      if (flushTimerRef.current) clearInterval(flushTimerRef.current)
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      releaseWakeLock()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    isTracking,
    sessionId,
    startedAt,
    elapsedMs,
    distanceM,
    pointCount,
    accuracy,
    error,
    start,
    stop,
  }
}
