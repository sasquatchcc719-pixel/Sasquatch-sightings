/**
 * Forward geocoding for service addresses using Nominatim.
 *
 * A service address is accepted only when Nominatim returns the submitted
 * house number and street. City/ZIP-level results are deliberately rejected:
 * storing an area centroid makes a failed lookup look successful and creates
 * false public map clusters.
 */

export interface ForwardGeocodeResult {
  lat: number
  lng: number
  displayName: string
  resolvedCity: string
  neighborhood: string
}

type SubmittedAddress = {
  street_1: string
  city: string
  state: string
  zip_code: string
}

const LOCATION_FIELDS = ['street_1', 'city', 'state', 'zip_code'] as const

export function invalidateGeocodeForAddressUpdate(
  updates: Record<string, unknown>,
): boolean {
  const locationChanged = LOCATION_FIELDS.some((field) => field in updates)
  if (!locationChanged) return false
  updates.latitude = null
  updates.longitude = null
  updates.geocoded_at = null
  updates.geocode_source = null
  return true
}

type NominatimAddress = {
  house_number?: string
  road?: string
  pedestrian?: string
  city?: string
  town?: string
  village?: string
  hamlet?: string
  municipality?: string
  suburb?: string
  neighbourhood?: string
  county?: string
  state?: string
  'ISO3166-2-lvl4'?: string
  postcode?: string
}

type NominatimCandidate = {
  lat?: string
  lon?: string
  display_name?: string
  address?: NominatimAddress
}

const STREET_TOKEN_ALIASES: Record<string, string> = {
  avenue: 'ave',
  boulevard: 'blvd',
  circle: 'cir',
  court: 'ct',
  drive: 'dr',
  east: 'e',
  highway: 'hwy',
  lane: 'ln',
  north: 'n',
  northeast: 'ne',
  northwest: 'nw',
  parkway: 'pkwy',
  place: 'pl',
  road: 'rd',
  south: 's',
  southeast: 'se',
  southwest: 'sw',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  west: 'w',
}

function normalizedTokens(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TOKEN_ALIASES[token] ?? token)
    .join(' ')
}

function submittedStreetParts(street: string): {
  houseNumber: string
  road: string
} | null {
  const withoutUnit = street
    .replace(
      /\s*(?:,\s*)?(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+.*$/i,
      '',
    )
    .trim()
  const match = withoutUnit.match(/^\s*(\d+[a-z]?)\s+(.+)$/i)
  if (!match) return null
  return {
    houseNumber: normalizedTokens(match[1]),
    road: normalizedTokens(match[2]),
  }
}

function normalizedZip(value: string): string {
  return value.replace(/\D/g, '').slice(0, 5)
}

function localityValues(address: NominatimAddress): string[] {
  return [
    address.city,
    address.town,
    address.village,
    address.hamlet,
    address.municipality,
  ]
    .filter((value): value is string => !!value)
    .map(normalizedTokens)
}

export function isVerifiedStreetCandidate(
  submitted: SubmittedAddress,
  candidate: NominatimCandidate,
): boolean {
  const street = submittedStreetParts(submitted.street_1)
  const address = candidate.address
  if (!street || !address) return false

  const candidateRoad = address.road ?? address.pedestrian ?? ''
  if (normalizedTokens(address.house_number ?? '') !== street.houseNumber) {
    return false
  }
  if (normalizedTokens(candidateRoad) !== street.road) return false

  const stateCode = normalizedTokens(address['ISO3166-2-lvl4'] ?? '')
  const stateName = normalizedTokens(address.state ?? '')
  const expectedState = normalizedTokens(submitted.state)
  const stateMatches =
    stateCode === `us ${expectedState}` ||
    (expectedState === 'co' && stateName === 'colorado') ||
    stateName === expectedState
  if (!stateMatches) return false

  const expectedZip = normalizedZip(submitted.zip_code)
  const candidateZip = normalizedZip(address.postcode ?? '')
  const zipMatches = !!expectedZip && candidateZip === expectedZip
  const cityMatches = localityValues(address).includes(
    normalizedTokens(submitted.city),
  )

  // Nominatim occasionally omits either city or postcode. Require at least one
  // to agree in addition to the exact house number, road, and state.
  return zipMatches || cityMatches
}

/** Forward-geocode a structured address to a verified street-level point. */
export async function forwardGeocodeAddress(
  address: SubmittedAddress,
): Promise<ForwardGeocodeResult | null> {
  try {
    const params = new URLSearchParams({
      format: 'json',
      street: address.street_1,
      city: address.city,
      state: address.state,
      postalcode: address.zip_code,
      countrycodes: 'us',
      limit: '5',
      addressdetails: '1',
    })
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          'User-Agent': 'SasquatchCarpetCleaning/1.0 (scheduling)',
        },
        signal: AbortSignal.timeout(10_000),
      },
    )

    if (!response.ok) {
      console.error(
        `[forward-geocode] Nominatim error: ${response.status} for ${address.street_1}, ${address.city}`,
      )
      return null
    }

    const results = (await response.json()) as unknown
    if (!Array.isArray(results)) return null
    const match = (results as NominatimCandidate[]).find((candidate) =>
      isVerifiedStreetCandidate(address, candidate),
    )
    if (!match) return null

    const lat = Number(match.lat)
    const lng = Number(match.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    const details = match.address ?? {}
    return {
      lat,
      lng,
      displayName: match.display_name ?? '',
      resolvedCity:
        details.city ??
        details.town ??
        details.village ??
        details.hamlet ??
        address.city,
      neighborhood:
        details.neighbourhood ?? details.suburb ?? details.county ?? '',
    }
  } catch (error) {
    console.error('[forward-geocode] Request failed:', error)
    return null
  }
}

/**
 * Run a verified geocode for a service address.
 * Failures leave coordinates empty so they can be retried or reviewed; they
 * never write an area centroid as if it were a successful street lookup.
 */
export async function queueGeocodeForAddress(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  addressId: string,
  address: SubmittedAddress,
): Promise<void> {
  try {
    const result = await forwardGeocodeAddress(address)
    if (!result) return

    const { error } = await supabase
      .from('ops_service_addresses')
      .update({
        latitude: result.lat,
        longitude: result.lng,
        geocoded_at: new Date().toISOString(),
        geocode_source: 'nominatim-street-verified',
        updated_at: new Date().toISOString(),
      })
      .eq('id', addressId)
      // Do not let a slow lookup write coordinates after the address changes.
      .eq('street_1', address.street_1)
      .eq('city', address.city)
      .eq('state', address.state)
      .eq('zip_code', address.zip_code)
    if (error) {
      console.error('[forward-geocode] Database update failed:', error)
    }
  } catch (error) {
    console.error('[forward-geocode] Background geocode failed:', error)
  }
}

/** Re-read an edited address, then queue a fresh verified street lookup. */
export async function queueGeocodeForStoredAddress(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  addressId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('ops_service_addresses')
    .select('street_1, city, state, zip_code')
    .eq('id', addressId)
    .maybeSingle()
  if (error || !data) {
    console.error('[forward-geocode] Could not reload edited address:', error)
    return
  }
  await queueGeocodeForAddress(supabase, addressId, data as SubmittedAddress)
}
