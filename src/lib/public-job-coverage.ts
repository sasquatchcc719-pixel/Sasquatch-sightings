export type HistoricalServiceAddress = {
  id: string
  customer_id: string
  street_1: string
  city: string
  state: string
  zip_code: string
  latitude: number | string | null
  longitude: number | string | null
  geocode_source?: string | null
}

export type PublishedJobLocation = {
  gps_lat: number | string | null
  gps_lng: number | string | null
  represented_address_id?: string | null
}

export type HistoricalJobPin = {
  id: string
  gps_fuzzy_lat: number
  gps_fuzzy_lng: number
}

const COLORADO_BOUNDS = {
  minLat: 36.8,
  maxLat: 41.2,
  minLng: -109.2,
  maxLng: -101.8,
}

const LEGACY_JOB_MATCH_METERS = 75
const MAX_DISTINCT_ADDRESSES_PER_COORDINATE = 10
const KNOWN_AREA_CENTERS = new Set([
  '38.833958|-104.825348',
  '39.091659|-104.872758',
  '39.228848|-104.884495',
  '39.122214|-104.917204',
])

function normalizeAddressPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function normalizedAddressKey(
  address: Pick<
    HistoricalServiceAddress,
    'street_1' | 'city' | 'state' | 'zip_code'
  >,
): string {
  return [address.street_1, address.city, address.state, address.zip_code]
    .map(normalizeAddressPart)
    .join('|')
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function deterministicFuzz(lat: number, lng: number, seed: string) {
  const first = hashString(seed)
  const second = hashString(`${seed}:radius`)
  const angle = (first / 0xffffffff) * Math.PI * 2
  const radiusMeters = 100 + (second / 0xffffffff) * 100
  const latOffset = (radiusMeters / 111_320) * Math.cos(angle)
  const lngOffset =
    (radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180))) *
    Math.sin(angle)

  return {
    lat: lat + latOffset,
    lng: lng + lngOffset,
  }
}

function distanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMeters = 6_371_000
  const deltaLat = radians(to.lat - from.lat)
  const deltaLng = radians(to.lng - from.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(from.lat)) *
      Math.cos(radians(to.lat)) *
      Math.sin(deltaLng / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a))
}

function isMappableColoradoCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= COLORADO_BOUNDS.minLat &&
    lat <= COLORADO_BOUNDS.maxLat &&
    lng >= COLORADO_BOUNDS.minLng &&
    lng <= COLORADO_BOUNDS.maxLng
  )
}

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)}|${lng.toFixed(6)}`
}

export function buildHistoricalJobPins(params: {
  addresses: HistoricalServiceAddress[]
  customerIdsWithJobHistory: Set<string>
  publishedJobs: PublishedJobLocation[]
}): HistoricalJobPin[] {
  const addressById = new Map(
    params.addresses.map((address) => [address.id, address]),
  )
  const representedAddressKeys = new Set(
    params.publishedJobs
      .map((job) =>
        job.represented_address_id
          ? addressById.get(job.represented_address_id)
          : null,
      )
      .filter((address): address is HistoricalServiceAddress => !!address)
      .map(normalizedAddressKey),
  )

  const legacyPublishedLocations = params.publishedJobs
    .filter((job) => !job.represented_address_id)
    .map((job) => ({
      lat: Number(job.gps_lat),
      lng: Number(job.gps_lng),
    }))
    .filter((point) => isMappableColoradoCoordinate(point.lat, point.lng))

  const uniqueAddresses = new Map<string, HistoricalServiceAddress>()
  for (const address of params.addresses) {
    if (!params.customerIdsWithJobHistory.has(address.customer_id)) continue

    const lat = Number(address.latitude)
    const lng = Number(address.longitude)
    if (!isMappableColoradoCoordinate(lat, lng)) continue

    const key = normalizedAddressKey(address)
    if (!key.startsWith('|') && !uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, address)
    }
  }

  const addressKeysByCoordinate = new Map<string, Set<string>>()
  for (const [addressKey, address] of uniqueAddresses) {
    const key = coordinateKey(
      Number(address.latitude),
      Number(address.longitude),
    )
    const addressKeys = addressKeysByCoordinate.get(key) ?? new Set<string>()
    addressKeys.add(addressKey)
    addressKeysByCoordinate.set(key, addressKeys)
  }

  const pins: HistoricalJobPin[] = []
  for (const [addressKey, address] of uniqueAddresses) {
    if (representedAddressKeys.has(addressKey)) continue

    const exactPoint = {
      lat: Number(address.latitude),
      lng: Number(address.longitude),
    }
    const exactCoordinateKey = coordinateKey(exactPoint.lat, exactPoint.lng)
    if (
      KNOWN_AREA_CENTERS.has(exactCoordinateKey) ||
      (addressKeysByCoordinate.get(exactCoordinateKey)?.size ?? 0) >
        MAX_DISTINCT_ADDRESSES_PER_COORDINATE
    ) {
      continue
    }
    const matchesLegacyPublishedJob = legacyPublishedLocations.some(
      (jobPoint) =>
        distanceMeters(jobPoint, exactPoint) <= LEGACY_JOB_MATCH_METERS,
    )
    if (matchesLegacyPublishedJob) continue

    const fuzzy = deterministicFuzz(exactPoint.lat, exactPoint.lng, addressKey)
    pins.push({
      id: `historical-${hashString(addressKey).toString(36)}`,
      gps_fuzzy_lat: fuzzy.lat,
      gps_fuzzy_lng: fuzzy.lng,
    })
  }

  return pins
}
