'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { haversineDistance } from '@/lib/gps/haversine'
import {
  addToOfflineQueue,
  flushOfflineQueue,
  type QueuedPoint,
} from '@/lib/gps/offlineQueue'
import { releaseWakeLock, requestWakeLock } from '@/lib/gps/wakeLock'

const GEOFENCE_RADIUS_M = 75
const FLUSH_INTERVAL_MS = 30_000
const BATCH_LIMIT = 50
const FAST_SPEED_MPS = 2.5

export type SegmentType = 'idle' | 'traveling' | 'on_site'

export interface AppointmentFence {
  id: string
  lat: number
  lng: number
  customerName: string
  status: string
}

export interface GpsTrackerValue {
  isClocked: boolean
  shiftId: string | null
  segmentType: SegmentType
  activeAppointmentLabel: string | null
  activeAppointmentId: string | null
  elapsedMs: number
  isOnBreak: boolean
  breakElapsedMs: number
  breakMinutes: number
  accuracy: number | null
  error: string | null
  clockIn: () => Promise<void>
  clockOut: () => Promise<void>
  startBreak: () => Promise<void>
  endBreak: () => Promise<void>
}

type ShiftPayload = {
  id: string
  started_at: string
  break_started_at?: string | null
  break_minutes?: number | null
}

export function useGpsTracker({
  enabled,
}: {
  enabled: boolean
}): GpsTrackerValue {
  // ── UI state (triggers re-renders) ──────────────────────────────────────
  const [isClocked, setIsClocked] = useState(false)
  const [segmentType, setSegmentType] = useState<SegmentType>('idle')
  const [activeAppointmentLabel, setActiveAppointmentLabel] = useState<
    string | null
  >(null)
  const [activeAppointmentId, setActiveAppointmentId] = useState<string | null>(
    null,
  )
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isOnBreak, setIsOnBreak] = useState(false)
  const [breakElapsedMs, setBreakElapsedMs] = useState(0)
  const [breakMinutes, setBreakMinutes] = useState(0)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Session refs (stable across renders, read by callbacks) ─────────────
  const shiftIdRef = useRef<string | null>(null)
  const clockedInAtRef = useRef<number | null>(null)
  const fencesRef = useRef<AppointmentFence[]>([])
  const currentFenceIdRef = useRef<string | null>(null)
  const arrivedAtRef = useRef<Set<string>>(new Set())
  const batchRef = useRef<QueuedPoint[]>([])
  const watchIdRef = useRef<number | null>(null)
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const breakStartedAtRef = useRef<number | null>(null)
  const savedBreakMinutesRef = useRef(0)

  const applyBreakState = useCallback((shift: ShiftPayload) => {
    const savedBreakMinutes = Math.max(0, Number(shift.break_minutes || 0))
    const breakStartedAt = shift.break_started_at
      ? new Date(shift.break_started_at).getTime()
      : null
    const validBreakStartedAt =
      breakStartedAt != null && Number.isFinite(breakStartedAt)
        ? breakStartedAt
        : null

    savedBreakMinutesRef.current = savedBreakMinutes
    breakStartedAtRef.current = validBreakStartedAt
    setBreakMinutes(savedBreakMinutes)
    setBreakElapsedMs(
      savedBreakMinutes * 60_000 +
        (validBreakStartedAt != null
          ? Math.max(0, Date.now() - validBreakStartedAt)
          : 0),
    )
    setIsOnBreak(validBreakStartedAt != null)
  }, [])

  // ── Flush batch to server ────────────────────────────────────────────────
  const flushBatch = useCallback(async () => {
    const toSend = batchRef.current.splice(0, batchRef.current.length)
    if (toSend.length === 0) return

    try {
      const res = await fetch('/api/admin/ops/gps/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: toSend }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      addToOfflineQueue(toSend)
    }
  }, [])

  // Stable ref so the watchPosition callback always calls the latest version
  const flushBatchRef = useRef(flushBatch)
  useEffect(() => {
    flushBatchRef.current = flushBatch
  }, [flushBatch])

  // ── Start watchPosition ──────────────────────────────────────────────────
  const startTracking = useCallback((activeShiftId: string) => {
    if (!('geolocation' in navigator)) {
      setError('GPS not available on this device')
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const {
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          speed,
          heading,
        } = pos.coords

        setAccuracy(acc)

        // Find nearest appointment geofence
        let nearestId: string | null = null
        let nearestLabel: string | null = null
        let nearestDist = Infinity

        for (const fence of fencesRef.current) {
          const dist = haversineDistance(lat, lng, fence.lat, fence.lng)
          if (dist < GEOFENCE_RADIUS_M && dist < nearestDist) {
            nearestDist = dist
            nearestId = fence.id
            nearestLabel = fence.customerName
          }
        }

        // Detect geofence transitions
        const prevFenceId = currentFenceIdRef.current
        const fenceChanged = nearestId !== prevFenceId
        currentFenceIdRef.current = nearestId

        // Emit arrival event (once per appointment per shift)
        if (nearestId && fenceChanged && !arrivedAtRef.current.has(nearestId)) {
          arrivedAtRef.current.add(nearestId)
        }

        // Determine segment type
        let seg: SegmentType
        if (nearestId) {
          seg = 'on_site'
        } else if ((speed ?? 0) > FAST_SPEED_MPS) {
          seg = 'traveling'
        } else {
          seg = 'idle'
        }

        setSegmentType(seg)
        setActiveAppointmentId(nearestId)
        setActiveAppointmentLabel(nearestLabel)

        // Add to batch
        const point: QueuedPoint = {
          shiftId: activeShiftId,
          capturedAt: new Date().toISOString(),
          lat,
          lng,
          accuracyM: acc,
          speedMps: speed ?? null,
          headingDeg: heading ?? null,
          segmentType:
            seg === 'on_site'
              ? 'on_site'
              : seg === 'traveling'
                ? 'travel'
                : 'idle',
          appointmentId: nearestId,
        }
        batchRef.current.push(point)

        // Flush immediately on fence transition or when batch is full
        if (batchRef.current.length >= BATCH_LIMIT || fenceChanged) {
          void flushBatchRef.current()
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError(
            'Location permission denied. Enable location for this site in Settings.',
          )
        }
        console.error('[GPS] watchPosition error:', err.message)
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )

    // Periodic flush
    flushIntervalRef.current = setInterval(() => {
      void flushBatchRef.current()
    }, FLUSH_INTERVAL_MS)
  }, [])

  // ── Elapsed clock ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isClocked) return

    elapsedIntervalRef.current = setInterval(() => {
      if (clockedInAtRef.current !== null) {
        setElapsedMs(Date.now() - clockedInAtRef.current)
      }
      setBreakElapsedMs(
        savedBreakMinutesRef.current * 60_000 +
          (breakStartedAtRef.current !== null
            ? Math.max(0, Date.now() - breakStartedAtRef.current)
            : 0),
      )
    }, 1000)

    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [isClocked])

  // ── Restore active shift on mount (page refresh recovery) ───────────────
  useEffect(() => {
    if (!enabled) return

    void (async () => {
      try {
        const res = await fetch('/api/admin/ops/gps/shifts/active')
        if (!res.ok) return
        const data = await res.json()
        if (data.shift) {
          shiftIdRef.current = data.shift.id
          clockedInAtRef.current = new Date(data.shift.started_at).getTime()
          fencesRef.current = data.fences ?? []
          applyBreakState(data.shift as ShiftPayload)
          setIsClocked(true)
          setElapsedMs(Date.now() - clockedInAtRef.current)
          startTracking(data.shift.id)
        }
      } catch {
        // No active shift or network error — silent
      }
    })()

    // Flush any points from a previous interrupted session
    void flushOfflineQueue()
  }, [applyBreakState, enabled, startTracking])

  // ── Clock In ─────────────────────────────────────────────────────────────
  const clockIn = useCallback(async () => {
    if (!enabled) return
    setError(null)

    try {
      const res = await fetch('/api/admin/ops/gps/shifts/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceInfo: {
            userAgent:
              typeof navigator !== 'undefined' ? navigator.userAgent : null,
          },
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Server error ${res.status}`,
        )
      }

      const { shift, fences } = await res.json()
      const startedAtMs = new Date(shift.started_at).getTime()
      const clockedInAt = Number.isFinite(startedAtMs)
        ? startedAtMs
        : Date.now()

      shiftIdRef.current = shift.id
      clockedInAtRef.current = clockedInAt
      fencesRef.current = fences ?? []
      arrivedAtRef.current = new Set()
      batchRef.current = []
      applyBreakState(shift as ShiftPayload)

      setIsClocked(true)
      setElapsedMs(Math.max(0, Date.now() - clockedInAt))

      await requestWakeLock()
      startTracking(shift.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock in')
    }
  }, [applyBreakState, enabled, startTracking])

  const startBreak = useCallback(async () => {
    if (!enabled || !shiftIdRef.current) return
    setError(null)

    try {
      const res = await fetch('/api/admin/ops/gps/shifts/break/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: shiftIdRef.current }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Server error ${res.status}`,
        )
      }

      const { shift } = await res.json()
      applyBreakState(shift as ShiftPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start break')
    }
  }, [applyBreakState, enabled])

  const endBreak = useCallback(async () => {
    if (!enabled || !shiftIdRef.current) return
    setError(null)

    try {
      const res = await fetch('/api/admin/ops/gps/shifts/break/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: shiftIdRef.current }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `Server error ${res.status}`,
        )
      }

      const { shift } = await res.json()
      applyBreakState(shift as ShiftPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end break')
    }
  }, [applyBreakState, enabled])

  // ── Clock Out ────────────────────────────────────────────────────────────
  const clockOut = useCallback(async () => {
    try {
      await flushBatchRef.current()

      const res = await fetch('/api/admin/ops/gps/shifts/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftId: shiftIdRef.current }),
      })

      if (!res.ok) throw new Error('Failed to end shift')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clock out')
    } finally {
      // Always stop tracking even if server call fails
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current)
        flushIntervalRef.current = null
      }
      releaseWakeLock()

      shiftIdRef.current = null
      clockedInAtRef.current = null
      fencesRef.current = []
      currentFenceIdRef.current = null
      arrivedAtRef.current = new Set()
      breakStartedAtRef.current = null
      savedBreakMinutesRef.current = 0

      setIsClocked(false)
      setSegmentType('idle')
      setActiveAppointmentId(null)
      setActiveAppointmentLabel(null)
      setElapsedMs(0)
      setIsOnBreak(false)
      setBreakElapsedMs(0)
      setBreakMinutes(0)
    }
  }, [])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      if (flushIntervalRef.current) clearInterval(flushIntervalRef.current)
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [])

  return {
    isClocked,
    shiftId: shiftIdRef.current,
    segmentType,
    activeAppointmentLabel,
    activeAppointmentId,
    elapsedMs,
    isOnBreak,
    breakElapsedMs,
    breakMinutes,
    accuracy,
    error,
    clockIn,
    clockOut,
    startBreak,
    endBreak,
  }
}
