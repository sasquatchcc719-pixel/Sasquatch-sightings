/**
 * Geocoding utilities using OpenStreetMap Nominatim API
 * Per .cursorrules: Using Nominatim (NOT Mapbox) for geocoding due to TOS requirements
 */

export type GeocodeResult = {
  city: string
  neighborhood: string | null
}

/**
 * Reverse geocode GPS coordinates to city and neighborhood
 * Uses OpenStreetMap Nominatim API
 * @param lat - Latitude
 * @param lng - Longitude
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodeResult> {
  try {
    // Nominatim API endpoint
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`

    // Fetch with required User-Agent header (Nominatim requirement)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SasquatchJobPinner/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`)
    }

    const data = await response.json()

    // Extract city from various possible fields
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.village ||
      data.address?.municipality ||
      'Unknown'

    // Extract neighborhood (optional)
    const neighborhood =
      data.address?.neighbourhood || data.address?.suburb || null

    return {
      city,
      neighborhood,
    }
  } catch (error) {
    console.error('Error reverse geocoding:', error)
    // Return fallback values on error
    return {
      city: 'Unknown',
      neighborhood: null,
    }
  }
}
