import { z } from 'zod'

const nullableNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable()

export const trackerPointSchema = z.object({
  bootId: z.uuid(),
  seq: z.number().int().min(0).max(4294967295),
  recordedAt: z.iso.datetime(),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  speedMps: nullableNumber(0, 150),
  bearing: z.number().finite().min(0).lt(360).nullable(),
  satellites: z.number().int().min(0).max(200).nullable(),
})

export const trackerTelemetrySchema = z.object({
  firmware: z.string().min(1).max(64),
  bootId: z.uuid(),
  uptimeMs: z.number().int().min(0).max(4294967295),
  batteryV: nullableNumber(2, 5),
  gpsFix: z.boolean(),
  points: z.array(trackerPointSchema).max(32),
})

export type FleetTracker = {
  id: string
  name: string
  enabled: boolean
  firmware: string | null
  battery_v: number | null
  gps_fix: boolean
  last_seen_at: string | null
  gps_at: string | null
  latitude: number | null
  longitude: number | null
  speed_mps: number | null
  bearing: number | null
  satellites: number | null
}

export type TrackerHistoryPoint = {
  recorded_at: string
  latitude: number
  longitude: number
  speed_mps: number | null
  bearing: number | null
  break_before?: boolean
}

export function trackerStatus(tracker: FleetTracker, now = Date.now()) {
  if (!tracker.enabled) return 'Disabled'
  if (!tracker.last_seen_at) return 'Waiting for first connection'
  if (now - Date.parse(tracker.last_seen_at) > 45_000) return 'Offline'
  if (
    !tracker.gps_fix ||
    !tracker.gps_at ||
    now - Date.parse(tracker.gps_at) > 30_000
  )
    return 'Connected · waiting for GPS'
  return (tracker.speed_mps ?? 0) > 1 ? 'Moving' : 'Parked'
}

/** Break history at signal gaps instead of drawing an invented trip across them. */
export function trackerHistoryLines(points: TrackerHistoryPoint[]) {
  const lines: number[][][] = []
  let line: number[][] = []
  let previous: TrackerHistoryPoint | undefined
  for (const point of points) {
    if (
      point.break_before ||
      (previous &&
        Date.parse(point.recorded_at) - Date.parse(previous.recorded_at) >
          90_000)
    ) {
      if (line.length > 1) lines.push(line)
      line = []
    }
    line.push([point.longitude, point.latitude])
    previous = point
  }
  if (line.length > 1) lines.push(line)
  return lines
}
