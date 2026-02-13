/**
 * Geocoding utilities using OpenStreetMap Nominatim API
 * Per .cursorrules: Using Nominatim (NOT Mapbox) for geocoding due to TOS requirements
 */

export type GeocodeResult = {
  city: string
  state: string | null
  neighborhood: string | null
}

/** Value that indicates geocoding did not resolve to a real city (never store this in DB) */
export const UNKNOWN_CITY = 'Unknown'

/**
 * Check if a city value is considered "unknown" and must not be stored for SEO.
 */
export function isUnknownCity(city: string | null | undefined): boolean {
  if (city == null || typeof city !== 'string') return true
  const t = city.trim().toLowerCase()
  return t === '' || t === 'unknown'
}

/**
 * Region fallback hierarchy for Colorado service areas when reverse geocode
 * does not return a specific city. Bounds are approximate (decimal degrees).
 * Order: Tri-Lakes → Colorado Springs Area → Northern Colorado → Colorado.
 */
const TRI_LAKES_LAT_MIN = 38.95
const TRI_LAKES_LAT_MAX = 39.3
const TRI_LAKES_LNG_MIN = -105.1
const TRI_LAKES_LNG_MAX = -104.7

const CO_SPRINGS_LAT_MIN = 38.6
const CO_SPRINGS_LAT_MAX = 39.45
const CO_SPRINGS_LNG_MIN = -105.15
const CO_SPRINGS_LNG_MAX = -104.35

const NORTHERN_CO_LAT_MIN = 39.6

const CO_STATE_LAT_MIN = 37
const CO_STATE_LAT_MAX = 41
const CO_STATE_LNG_MIN = -109
const CO_STATE_LNG_MAX = -102

/**
 * Get a display-friendly city/region name from coordinates when reverse geocode
 * returns nothing useful. Never returns "Unknown". Used for jobs and backfill.
 */
export function getCityFallbackForCoordinates(
  lat: number,
  lng: number,
): string {
  if (
    lat >= TRI_LAKES_LAT_MIN &&
    lat <= TRI_LAKES_LAT_MAX &&
    lng >= TRI_LAKES_LNG_MIN &&
    lng <= TRI_LAKES_LNG_MAX
  ) {
    return 'Tri-Lakes Area'
  }
  if (
    lat >= CO_SPRINGS_LAT_MIN &&
    lat <= CO_SPRINGS_LAT_MAX &&
    lng >= CO_SPRINGS_LNG_MIN &&
    lng <= CO_SPRINGS_LNG_MAX
  ) {
    return 'Colorado Springs Area'
  }
  if (lat >= NORTHERN_CO_LAT_MIN) {
    return 'Northern Colorado'
  }
  if (
    lat >= CO_STATE_LAT_MIN &&
    lat <= CO_STATE_LAT_MAX &&
    lng >= CO_STATE_LNG_MIN &&
    lng <= CO_STATE_LNG_MAX
  ) {
    return 'Colorado'
  }
  return 'Colorado'
}

/**
 * Reverse geocode GPS coordinates to city and neighborhood.
 * Uses OpenStreetMap Nominatim API.
 * May return city "Unknown" on failure or when no locality is found.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SasquatchJobPinner/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`)
    }

    const data = await response.json()

    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.municipality ||
      UNKNOWN_CITY

    const state = data.address?.state_code || data.address?.state || null
    const neighborhood =
      data.address?.neighbourhood || data.address?.suburb || null

    return {
      city,
      state,
      neighborhood,
    }
  } catch (error) {
    console.error('Error reverse geocoding:', error)
    return {
      city: UNKNOWN_CITY,
      state: null,
      neighborhood: null,
    }
  }
}

/**
 * Resolve city (and state, neighborhood) for a job from GPS coordinates.
 * Never returns "Unknown": if reverse geocode fails or returns no city,
 * applies region fallback (Tri-Lakes Area, Colorado Springs Area, etc.).
 * Use this for all job creation and backfills.
 */
export async function resolveCityForJob(
  lat: number,
  lng: number,
): Promise<GeocodeResult> {
  const result = await reverseGeocode(lat, lng)
  if (!isUnknownCity(result.city)) {
    return result
  }
  const fallback = getCityFallbackForCoordinates(lat, lng)
  return {
    city: fallback,
    state: result.state || 'CO',
    neighborhood: result.neighborhood,
  }
}
