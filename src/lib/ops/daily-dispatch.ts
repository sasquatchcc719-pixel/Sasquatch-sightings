import type { TrackerHistoryPoint } from '@/lib/fleet-tracking'
import { PUBLIC_AREAS } from '@/lib/public-areas'
import { mountainLocalDateTimeToIso } from './timesheet-pay'

export type DispatchLocation = { lat: number; lng: number; source: string }
export type DispatchJob = {
  id: string
  date: string
  start: string
  end: string
  status: string
  name: string
  address: string
  staffId: string | null
  staffName: string
  href: string
  location: DispatchLocation | null
}
export type DailyDispatch = {
  date: string
  jobs: DispatchJob[]
  defaultStaffId: string | null
}

export function isDispatchDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const date = new Date(`${day}T12:00:00Z`)
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
  )
}

export function dispatchDayBounds(day: string) {
  if (!isDispatchDay(day)) return null
  const next = new Date(`${day}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const start = mountainLocalDateTimeToIso(day, '00:00')
  const end = mountainLocalDateTimeToIso(
    next.toISOString().slice(0, 10),
    '00:00',
  )
  return start && end ? { start, end } : null
}

function streetPoint(
  lat: unknown,
  lng: unknown,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null
  const point = { lat: Number(lat), lng: Number(lng) }
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180 ||
    (point.lat === 0 && point.lng === 0)
  )
    return null
  if (
    Object.values(PUBLIC_AREAS).some(
      (area) =>
        Math.abs(area.lat - point.lat) < 0.000001 &&
        Math.abs(area.lng - point.lng) < 0.000001,
    )
  )
    return null
  return point
}

export function dispatchLocation(
  address: {
    latitude?: unknown
    longitude?: unknown
    geocode_source?: string | null
    geocoded_at?: string | null
  } | null,
  gpsLat: unknown,
  gpsLng: unknown,
): DispatchLocation | null {
  const verified =
    address?.geocoded_at &&
    [
      'nominatim-street-verified',
      'repair:colorado-springs-address-point',
    ].includes(address.geocode_source ?? '')
  const point = verified
    ? streetPoint(address?.latitude, address?.longitude)
    : null
  if (point) return { ...point, source: 'Verified address' }
  const gps = streetPoint(gpsLat, gpsLng)
  return gps ? { ...gps, source: 'On-site GPS' } : null
}

export type DriveInterval = {
  start: string
  end: string
  points: TrackerHistoryPoint[]
}

// Observed motion only. Signal gaps split drives; no inferred job arrivals or mileage.
export function driveIntervals(points: TrackerHistoryPoint[]): DriveInterval[] {
  const drives: DriveInterval[] = []
  let start = -1,
    lastMoving = -1,
    previous = -1
  const finish = () => {
    if (start >= 0 && lastMoving > start)
      drives.push({
        start: points[start].recorded_at,
        end: points[lastMoving].recorded_at,
        points: points.slice(start, lastMoving + 1),
      })
    start = lastMoving = -1
  }
  points.forEach((point, i) => {
    const time = Date.parse(point.recorded_at)
    if (previous >= 0 && time - previous > 90000) finish()
    if ((point.speed_mps ?? 0) > 1) {
      if (start < 0) start = i
      lastMoving = i
    } else if (
      lastMoving >= 0 &&
      time - Date.parse(points[lastMoving].recorded_at) >= 120000
    )
      finish()
    previous = time
  })
  finish()
  return drives
}
