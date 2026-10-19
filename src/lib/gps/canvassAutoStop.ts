import { haversineDistance } from './haversine'

// Charles requested a walking-only cutoff for David; Brianna delivers by e-bike.
export const DAVID_CANVASS_USER_ID = 'f7f07ef7-4f57-4cbb-b8b8-162404926c08'
export const CANVASS_AUTO_STOP_NOTE =
  'Automatically stopped: movement exceeded walking limits. The last walking point was saved.'

export type CanvassPoint = {
  lat: number
  lng: number
  accuracyM: number | null
  recordedAt: string
}

export function exceedsWalkingLimits(
  previous: CanvassPoint,
  next: CanvassPoint,
) {
  const seconds =
    (Date.parse(next.recordedAt) - Date.parse(previous.recordedAt)) / 1000
  if (!Number.isFinite(seconds) || seconds <= 0) return false
  if ((previous.accuracyM ?? 0) > 50 || (next.accuracyM ?? 0) > 50) return false
  const meters = haversineDistance(
    previous.lat,
    previous.lng,
    next.lat,
    next.lng,
  )
  // Small jumps are ordinary GPS jitter. Subtract both accuracy radii before
  // judging speed (~6.7 mph); a >800m gap is too far to infer a walking route.
  const minimumTravel = Math.max(
    0,
    meters - (previous.accuracyM ?? 0) - (next.accuracyM ?? 0),
  )
  return meters > 800 || (meters > 150 && minimumTravel / seconds > 3)
}
