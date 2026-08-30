/**
 * Arrival detection for a job visit.
 *
 * Pulled out of `appointment-detail.tsx`, where it sat inline and untested,
 * so the restoration screen uses the same rule rather than a second copy that
 * quietly disagrees about how close counts as "here".
 */

/** Roughly 100 feet — close enough to be at the property, not the next street. */
export const ARRIVAL_THRESHOLD_METERS = 30

/** Great-circle distance between two points, in metres. */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function hasArrived(distance: number | null): boolean {
  return distance != null && distance <= ARRIVAL_THRESHOLD_METERS
}

/** Human-readable distance for the status bar. */
export function formatDistance(meters: number | null): string {
  if (meters == null) return 'locating…'
  if (meters <= ARRIVAL_THRESHOLD_METERS) return 'at the property'
  const feet = meters * 3.28084
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft away`
  return `${(meters / 1609.34).toFixed(1)} mi away`
}

/** Geocode an address with Mapbox. Returns null rather than throwing. */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) return null

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      address,
    )}.json?access_token=${token}&limit=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as { features?: Array<{ center?: [number, number] }> }
    const coords = data.features?.[0]?.center
    if (!coords || coords.length !== 2) return null
    return { lng: coords[0], lat: coords[1] }
  } catch {
    return null
  }
}

export type VisitStatus =
  | 'booked'
  | 'confirmed'
  | 'on_my_way'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'pending_approval'

/** The one action that moves a visit forward from where it is now. */
export function nextVisitAction(
  status: VisitStatus,
): { status: VisitStatus; label: string } | null {
  switch (status) {
    case 'booked':
    case 'confirmed':
      return { status: 'on_my_way', label: 'On My Way' }
    case 'on_my_way':
      return { status: 'in_progress', label: 'Start work' }
    case 'in_progress':
      return { status: 'completed', label: 'Finish visit' }
    default:
      return null
  }
}
