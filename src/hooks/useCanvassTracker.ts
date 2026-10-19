'use client'

/**
 * Canvassing GPS tracker — Start/Stop door-hanger route recording.
 * Simplified sibling of useGpsTracker: no geofencing, no shifts, no payroll.
 * Points buffer locally (localStorage-backed, survives a reload) and flush
 * to the server every 30s. A wake lock keeps the screen alive while walking.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { haversineDistance } from '@/lib/gps/haversine'
import {
  CANVASS_AUTO_STOP_NOTE,
  exceedsWalkingLimits,
} from '@/lib/gps/canvassAutoStop'
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
  autoStopMessage: string | null
  start: () => Promise<void>
  stop: () => Promise<{ distanceM: number; pointCount: number } | null>
}

function loadStash(): {
  sessionId: string
  points: PendingPoint[]
  autoStopPending?: boolean
} | null {
  try {
    const raw = localStorage.getItem(STASH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveStash(
  sessionId: string,
  points: PendingPoint[],
  autoStopPending = false,
): void {
  try {
    localStorage.setItem(
      STASH_KEY,
      JSON.stringify({ sessionId, points, autoStopPending }),
    )
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

  const [autoStopMessage, setAutoStopMessage] = useState<string | null>(null)
  const walkingAutoStopRef = useRef(false)
  const autoStopPendingRef = useRef(false)
  const flushPromiseRef = useRef<Promise<void> | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bufferRef = useRef<PendingPoint[]>([])
  const lastPointRef = useRef<PendingPoint | null>(null)
  const walkingAnchorRef = useRef<PendingPoint | null>(null)
  const sessionRef = useRef<string | null>(null)

  const detach = useCallback(() => {
    if (watchIdRef.current != null)
      navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
    if (flushTimerRef.current) clearInterval(flushTimerRef.current)
    if (tickTimerRef.current) clearInterval(tickTimerRef.current)
    releaseWakeLock()
  }, [])

  const flush = useCallback(async () => {
    // Serialize uploads so a slow request cannot race the automatic cutoff.
    while (flushPromiseRef.current) await flushPromiseRef.current
    const sid = sessionRef.current
    if (!sid || bufferRef.current.length === 0) return
    const validatingCutoff = autoStopPendingRef.current
    const batch = bufferRef.current
    bufferRef.current = []
    const upload = (async () => {
      try {
        const res = await fetch('/api/field/canvass/points', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, points: batch }),
        })
        if (res.status === 403 || res.status === 409) {
          detach()
          bufferRef.current = []
          sessionRef.current = null
          setSessionId(null)
          setIsTracking(false)
          setError(
            'This tracking session is no longer open. Tap Start to begin a new walk.',
          )
          try {
            localStorage.removeItem(STASH_KEY)
          } catch {
            /* storage unavailable */
          }
          return
        }
        if (!res.ok) throw new Error(`flush failed: ${res.status}`)
        const data = await res.json()
        if (sessionRef.current !== sid) return
        if (data.autoStopped) {
          detach()
          bufferRef.current = []
          try {
            localStorage.removeItem(STASH_KEY)
          } catch {
            /* storage unavailable */
          }
          sessionRef.current = null
          setSessionId(null)
          setIsTracking(false)
          setError(null)
          setAutoStopMessage(
            CANVASS_AUTO_STOP_NOTE +
              ' Tap Start when you are ready to walk again.',
          )
          return
        }
        if (validatingCutoff) {
          autoStopPendingRef.current = false
          setError(null)
        }
        saveStash(sid, bufferRef.current, autoStopPendingRef.current)
      } catch {
        bufferRef.current = [...batch, ...bufferRef.current]
        saveStash(sid, bufferRef.current, autoStopPendingRef.current)
        if (autoStopPendingRef.current) {
          setError(
            'Movement detected. Recording is paused; the walk will save and stop when your connection returns.',
          )
        }
      }
    })()
    flushPromiseRef.current = upload
    try {
      await upload
    } finally {
      flushPromiseRef.current = null
    }
  }, [detach])

  const handlePosition = useCallback(
    (pos: GeolocationPosition) => {
      if (!sessionRef.current || autoStopPendingRef.current) return
      const { latitude, longitude, accuracy: acc, speed } = pos.coords
      setAccuracy(acc ?? null)
      if (acc != null && acc > 50) return
      const point: PendingPoint = {
        lat: latitude,
        lng: longitude,
        accuracyM: acc ?? null,
        speedMps: speed ?? null,
        recordedAt: new Date(pos.timestamp || Date.now()).toISOString(),
      }
      const last = lastPointRef.current
      if (last) {
        if (Date.parse(point.recordedAt) <= Date.parse(last.recordedAt)) return
        const anchor = walkingAnchorRef.current ?? last
        if (
          walkingAutoStopRef.current &&
          (exceedsWalkingLimits(last, point) ||
            exceedsWalkingLimits(anchor, point))
        ) {
          // Send the triggering fix for server verification without counting it
          // as walked distance. Freeze further recording while offline/retrying.
          autoStopPendingRef.current = true
          bufferRef.current.push(point)
          saveStash(
            sessionRef.current,
            bufferRef.current,
            autoStopPendingRef.current,
          )
          setError(
            'Movement exceeded walking limits — saving and stopping tracking…',
          )
          void flush()
          return
        }
        const moved = haversineDistance(last.lat, last.lng, latitude, longitude)
        if (moved < MIN_MOVE_METERS) return
        setDistanceM((d) => d + moved)
      }
      lastPointRef.current = point
      if (
        !walkingAnchorRef.current ||
        Date.parse(point.recordedAt) -
          Date.parse(walkingAnchorRef.current.recordedAt) >=
          60_000
      ) {
        walkingAnchorRef.current = point
      }
      bufferRef.current.push(point)
      setPointCount((c) => c + 1)
      saveStash(
        sessionRef.current,
        bufferRef.current,
        autoStopPendingRef.current,
      )
    },
    [flush],
  )

  const start = useCallback(async () => {
    setError(null)
    setAutoStopMessage(null)
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
      walkingAutoStopRef.current = data.walkingAutoStop === true
      autoStopPendingRef.current = false
      lastPointRef.current = data.lastPoint
        ? {
            lat: data.lastPoint.lat,
            lng: data.lastPoint.lng,
            accuracyM: data.lastPoint.accuracy_m,
            speedMps: null,
            recordedAt: data.lastPoint.recorded_at,
          }
        : null
      walkingAnchorRef.current = lastPointRef.current

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
    await flush()
    if (!sessionRef.current) return null
    if (bufferRef.current.length || autoStopPendingRef.current) {
      setError(
        'The walk is waiting to upload. Keep this page open; pending GPS points have been saved on this phone.',
      )
      return null
    }
    detach()
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
  }, [detach, flush])

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
          autoStopPendingRef.current = stash.autoStopPending === true
        }
        walkingAutoStopRef.current = data.walkingAutoStop === true
        const saved = data.lastPoint
          ? {
              lat: data.lastPoint.lat,
              lng: data.lastPoint.lng,
              accuracyM: data.lastPoint.accuracy_m,
              speedMps: null,
              recordedAt: data.lastPoint.recorded_at,
            }
          : null
        lastPointRef.current = bufferRef.current.at(-1) ?? saved
        walkingAnchorRef.current = saved
        if (walkingAutoStopRef.current) {
          let previous: PendingPoint | null = saved
          for (const point of bufferRef.current) {
            if (previous && exceedsWalkingLimits(previous, point)) {
              autoStopPendingRef.current = true
              break
            }
            previous = point
          }
        }
        sessionRef.current = data.session.id
        setSessionId(data.session.id)
        setStartedAt(data.session.started_at)
        setIsTracking(true)
        // Let the server validate recovered offline points before GPS resumes.
        await flush()
        if (cancelled || sessionRef.current !== data.session.id) return
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
    autoStopMessage,
    start,
    stop,
  }
}
