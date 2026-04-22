/**
 * Forward geocoding for service addresses using Nominatim.
 * Per .cursorrules: Nominatim only (NOT Mapbox) for geocoding due to TOS.
 * Rate limit: 1 request/second max.
 */

export interface ForwardGeocodeResult {
  lat: number
  lng: number
  displayName: string
}

/**
 * Forward-geocode a structured address to coordinates.
 * Returns null if the address cannot be resolved.
 */
export async function forwardGeocodeAddress(address: {
  street_1: string
  city: string
  state: string
  zip_code: string
}): Promise<ForwardGeocodeResult | null> {
  try {
    const params = new URLSearchParams({
      format: 'json',
      street: address.street_1,
      city: address.city,
      state: address.state,
      postalcode: address.zip_code,
      countrycodes: 'us',
      limit: '1',
      addressdetails: '0',
    })

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SasquatchCarpetCleaning/1.0 (scheduling)',
      },
    })

    if (!response.ok) {
      console.error(
        `[forward-geocode] Nominatim error: ${response.status} for ${address.street_1}, ${address.city}`,
      )
      return null
    }

    const results = await response.json()

    if (!Array.isArray(results) || results.length === 0) {
      // Try a less specific query (just zip + city)
      return forwardGeocodeByZip(address.city, address.state, address.zip_code)
    }

    const first = results[0]
    const lat = parseFloat(first.lat)
    const lng = parseFloat(first.lon)

    if (isNaN(lat) || isNaN(lng)) return null

    return { lat, lng, displayName: first.display_name ?? '' }
  } catch (error) {
    console.error('[forward-geocode] Request failed:', error)
    return null
  }
}

/**
 * Fallback: geocode by city + state + zip only, without street.
 * Returns center of the zip/city area.
 */
async function forwardGeocodeByZip(
  city: string,
  state: string,
  zip: string,
): Promise<ForwardGeocodeResult | null> {
  try {
    const params = new URLSearchParams({
      format: 'json',
      city,
      state,
      postalcode: zip,
      countrycodes: 'us',
      limit: '1',
      addressdetails: '0',
    })

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`

    const response = await fetch(url, {
      headers: { 'User-Agent': 'SasquatchCarpetCleaning/1.0 (scheduling)' },
    })

    if (!response.ok) return null

    const results = await response.json()
    if (!Array.isArray(results) || results.length === 0) return null

    const first = results[0]
    const lat = parseFloat(first.lat)
    const lng = parseFloat(first.lon)
    if (isNaN(lat) || isNaN(lng)) return null

    return { lat, lng, displayName: first.display_name ?? '' }
  } catch {
    return null
  }
}

/**
 * Queue a non-blocking background geocode for a service address.
 * Call this after inserting/updating an address record.
 * Failures are logged but never thrown.
 */
export function queueGeocodeForAddress(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  addressId: string,
  address: { street_1: string; city: string; state: string; zip_code: string },
): void {
  void (async () => {
    try {
      const result = await forwardGeocodeAddress(address)
      if (!result) return

      await supabase
        .from('ops_service_addresses')
        .update({
          latitude: result.lat,
          longitude: result.lng,
          geocoded_at: new Date().toISOString(),
          geocode_source: 'nominatim',
          updated_at: new Date().toISOString(),
        })
        .eq('id', addressId)
    } catch (err) {
      console.error('[forward-geocode] Background geocode failed:', err)
    }
  })()
}
