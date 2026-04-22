'use client'

/**
 * localStorage-based offline GPS point queue.
 * Buffers points when the network is unavailable and flushes them on reconnect.
 * No new packages required — uses localStorage directly.
 */

const QUEUE_KEY = 'sasquatch_gps_offline_queue'
const MAX_QUEUE_AGE_MS = 4 * 60 * 60 * 1000 // discard points older than 4 hours

export interface QueuedPoint {
  shiftId: string
  capturedAt: string
  lat: number
  lng: number
  accuracyM: number | null
  speedMps: number | null
  headingDeg: number | null
  segmentType: 'travel' | 'on_site' | 'idle' | 'unknown'
  appointmentId: string | null
}

function readQueue(): QueuedPoint[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: QueuedPoint[] = JSON.parse(raw)
    // Purge old entries
    const cutoff = Date.now() - MAX_QUEUE_AGE_MS
    return parsed.filter((p) => new Date(p.capturedAt).getTime() > cutoff)
  } catch {
    return []
  }
}

function writeQueue(points: QueuedPoint[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(points))
  } catch {
    // localStorage full — clear and start fresh
    try {
      localStorage.removeItem(QUEUE_KEY)
    } catch {}
  }
}

export function addToOfflineQueue(points: QueuedPoint[]): void {
  if (typeof window === 'undefined') return
  const existing = readQueue()
  writeQueue([...existing, ...points])
}

/**
 * Flush all queued offline points to the server.
 * Called on mount and whenever connectivity is restored.
 */
export async function flushOfflineQueue(): Promise<void> {
  if (typeof window === 'undefined') return

  const queue = readQueue()
  if (queue.length === 0) return

  // Clear queue optimistically before sending
  writeQueue([])

  try {
    const res = await fetch('/api/admin/ops/gps/points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: queue }),
    })

    if (!res.ok) {
      // Put them back on failure (but not too old)
      addToOfflineQueue(queue)
    }
  } catch {
    addToOfflineQueue(queue)
  }
}

export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {}
}

export function getOfflineQueueSize(): number {
  return readQueue().length
}
