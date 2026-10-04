import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

config({ path: path.join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing Supabase credentials in .env.local')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BAD_CENTERS = [
  { lat: 38.8339578, lng: -104.825348, label: 'Colorado Springs centroid' },
  { lat: 39.0916586, lng: -104.872758, label: 'Monument centroid' },
  { lat: 39.2288481, lng: -104.8844945, label: 'Larkspur centroid' },
  { lat: 39.1222138, lng: -104.917204, label: 'Palmer Lake centroid' },
] as const

type Address = {
  id: string
  customer_id: string
  street_1: string
  street_2: string | null
  city: string
  state: string
  zip_code: string
  latitude: number
  longitude: number
}

type Appointment = {
  id: string
  service_address_id: string | null
  status: string
  appointment_date: string
  gps_lat: number | string | null
  gps_lng: number | string | null
}

type Invoice = { id: string; appointment_id: string | null }
type Job = {
  id: string
  ops_invoice_id: string | null
  gps_lat: number | string | null
  gps_lng: number | string | null
}

type Point = { lat: number; lng: number; source: string }

type CensusBatchResult = {
  id: string
  status: string
  matchType: string
  matchedAddress: string
  lat: number | null
  lng: number | null
}

type CensusSingleMatch = {
  matchedAddress: string
  lat: number
  lng: number
  tigerLineId: string | null
}

type OfficialGisMatch = {
  source:
    | 'colorado-springs-address-point'
    | 'douglas-county-locator'
    | 'colorado-state-address-point'
  matchedAddress: string
  city: string | null
  zipCode: string | null
  lat: number
  lng: number
  score: number | null
  matchType: string | null
}

type PhotonMatch = {
  matchedAddress: string
  city: string | null
  zipCode: string | null
  lat: number
  lng: number
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && quoted && next === '"') {
      field += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      row.push(field)
      field = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function finitePoint(
  latValue: number | string | null,
  lngValue: number | string | null,
  source: string,
): Point | null {
  const lat = Number(latValue)
  const lng = Number(lngValue)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < 36.8 || lat > 41.2 || lng < -109.2 || lng > -101.8) return null
  return { lat, lng, source }
}

function distanceMeters(a: Point, b: Point): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusMeters = 6_371_000
  const deltaLat = radians(b.lat - a.lat)
  const deltaLng = radians(b.lng - a.lng)
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value))
}

function stripUnit(street: string): string {
  return street
    .replace(
      /\s*(?:,\s*)?(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+.*$/i,
      '',
    )
    .trim()
}

function streetNumber(street: string): number | null {
  const match = stripUnit(street).match(/^\s*(\d+)/)
  const value = Number(match?.[1])
  return Number.isInteger(value) ? value : null
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

function normalizedStreet(street: string): string {
  return stripUnit(street)
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((token) => STREET_TOKEN_ALIASES[token] ?? token)
    .join(' ')
}

function normalizedCity(city: string): string {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function levenshteinDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex]
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + Number(left[leftIndex - 1] !== right[rightIndex - 1]),
      )
      diagonal = above
    }
  }
  return row[right.length]
}

function streetSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  return (
    1 - levenshteinDistance(left, right) / Math.max(left.length, right.length)
  )
}

function roadTypeMatches(left: string, right: string): boolean {
  return left.split(' ').at(-1) === right.split(' ').at(-1)
}

function uniqueFuzzyMatch<T extends { candidateStreet: string }>(
  candidates: T[],
  targetStreet: string,
): (T & { similarity: number }) | null {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      similarity: streetSimilarity(candidate.candidateStreet, targetStreet),
    }))
    .filter(
      (candidate) =>
        candidate.similarity >= 0.88 &&
        roadTypeMatches(candidate.candidateStreet, targetStreet),
    )
    .sort((a, b) => b.similarity - a.similarity)
  if (!ranked[0]) return null
  if (ranked[1] && ranked[0].similarity - ranked[1].similarity < 0.05) {
    return null
  }
  return ranked[0]
}

async function coloradoSpringsAddressPoint(
  address: Address,
): Promise<OfficialGisMatch | null> {
  const number = streetNumber(address.street_1)
  if (number == null) return null

  const params = new URLSearchParams({
    where: `Add_Number = ${number}`,
    outFields: 'FullAddress,FullStreet,City,Post_Code,Lat,Long',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  })
  const response = await fetch(
    `https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/LandRecords/MapServer/0/query?${params}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    features?: Array<{
      attributes?: {
        FullAddress?: string
        FullStreet?: string
        City?: string
        Post_Code?: string
        Lat?: number
        Long?: number
      }
      geometry?: { x?: number; y?: number }
    }>
  }

  const targetStreet = normalizedStreet(address.street_1)
  const candidates = (payload.features ?? [])
    .map((feature) => {
      const attributes = feature.attributes ?? {}
      const candidateStreet = normalizedStreet(
        attributes.FullStreet ?? attributes.FullAddress ?? '',
      )
      const lat = Number(feature.geometry?.y ?? attributes.Lat)
      const lng = Number(feature.geometry?.x ?? attributes.Long)
      const streetMatches = candidateStreet === targetStreet
      const cityMatches =
        !attributes.City ||
        normalizedCity(attributes.City) === normalizedCity(address.city)
      const zipMatches =
        !attributes.Post_Code || attributes.Post_Code === address.zip_code
      return {
        attributes,
        lat,
        lng,
        candidateStreet,
        streetMatches,
        cityMatches,
        zipMatches,
      }
    })
    .filter(
      (candidate) =>
        Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng),
    )
    .sort(
      (a, b) =>
        Number(b.cityMatches) +
        Number(b.zipMatches) -
        (Number(a.cityMatches) + Number(a.zipMatches)),
    )

  const exact = candidates.find((candidate) => candidate.streetMatches)
  const fuzzy = exact
    ? null
    : uniqueFuzzyMatch(
        candidates.filter(
          (candidate) => candidate.cityMatches && candidate.zipMatches,
        ),
        targetStreet,
      )
  const best = exact ?? fuzzy
  if (!best) return null
  return {
    source: 'colorado-springs-address-point',
    matchedAddress:
      best.attributes.FullAddress ??
      `${number} ${best.attributes.FullStreet ?? ''}`,
    city: best.attributes.City ?? null,
    zipCode: best.attributes.Post_Code ?? null,
    lat: best.lat,
    lng: best.lng,
    score: 'similarity' in best ? best.similarity * 100 : 100,
    matchType: fuzzy ? 'PointAddressFuzzyStreet' : 'PointAddress',
  }
}

async function douglasCountyAddress(
  address: Address,
): Promise<OfficialGisMatch | null> {
  const params = new URLSearchParams({
    SingleLine: `${stripUnit(address.street_1)}, ${address.city}, ${address.state} ${address.zip_code}`,
    outFields: 'Match_addr,Addr_type,City,Postal',
    maxLocations: '5',
    outSR: '4326',
    f: 'json',
  })
  const response = await fetch(
    `https://apps.douglas.co.us/gisis/rest/services/DCComposite/GeocodeServer/findAddressCandidates?${params}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    candidates?: Array<{
      address?: string
      score?: number
      location?: { x?: number; y?: number }
      attributes?: {
        Match_addr?: string
        Addr_type?: string
        City?: string
        Postal?: string
      }
    }>
  }
  const targetStreet = normalizedStreet(address.street_1)
  const candidates = (payload.candidates ?? [])
    .map((candidate) => {
      const score = Number(candidate.score)
      const lat = Number(candidate.location?.y)
      const lng = Number(candidate.location?.x)
      const matched =
        candidate.attributes?.Match_addr ?? candidate.address ?? ''
      return {
        candidate,
        candidateStreet: normalizedStreet(matched),
        score,
        lat,
        lng,
      }
    })
    .filter(
      (candidate) =>
        candidate.score >= 90 &&
        Number.isFinite(candidate.lat) &&
        Number.isFinite(candidate.lng),
    )
  const exact = candidates
    .filter((candidate) => candidate.candidateStreet === targetStreet)
    .sort((a, b) => b.score - a.score)[0]
  const fuzzy = exact ? null : uniqueFuzzyMatch(candidates, targetStreet)
  const best = exact ?? fuzzy
  if (!best) return null
  return {
    source: 'douglas-county-locator',
    matchedAddress:
      best.candidate.attributes?.Match_addr ?? best.candidate.address ?? '',
    city: best.candidate.attributes?.City ?? null,
    zipCode: best.candidate.attributes?.Postal ?? null,
    lat: best.lat,
    lng: best.lng,
    score: fuzzy ? fuzzy.similarity * 100 : best.score,
    matchType: fuzzy
      ? 'PointAddressFuzzyStreet'
      : (best.candidate.attributes?.Addr_type ?? null),
  }
}

async function coloradoStateAddressPoint(
  address: Address,
): Promise<OfficialGisMatch | null> {
  const number = streetNumber(address.street_1)
  if (number == null) return null
  const escapedNumber = String(number).replaceAll("'", "''")
  const params = new URLSearchParams({
    where: `AddrNum = '${escapedNumber}'`,
    outFields: 'AddrFull,PlaceName,Zipcode,Latitude,Longitude',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  })
  const response = await fetch(
    `https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Addresses/FeatureServer/0/query?${params}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    features?: Array<{
      attributes?: {
        AddrFull?: string
        PlaceName?: string
        Zipcode?: string
        Latitude?: number
        Longitude?: number
      }
      geometry?: { x?: number; y?: number }
    }>
  }
  const targetStreet = normalizedStreet(address.street_1)
  const candidates = (payload.features ?? [])
    .map((feature) => {
      const attributes = feature.attributes ?? {}
      const lat = Number(feature.geometry?.y ?? attributes.Latitude)
      const lng = Number(feature.geometry?.x ?? attributes.Longitude)
      const cityMatches =
        !attributes.PlaceName ||
        normalizedCity(attributes.PlaceName) === normalizedCity(address.city)
      const zipMatches =
        !attributes.Zipcode || attributes.Zipcode === address.zip_code
      const candidateStreet = normalizedStreet(attributes.AddrFull ?? '')
      return {
        attributes,
        lat,
        lng,
        candidateStreet,
        streetMatches: candidateStreet === targetStreet,
        cityMatches,
        zipMatches,
      }
    })
    .filter(
      (candidate) =>
        Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng),
    )
    .sort(
      (a, b) =>
        Number(b.cityMatches) +
        Number(b.zipMatches) -
        (Number(a.cityMatches) + Number(a.zipMatches)),
    )
  const exact = candidates.find((candidate) => candidate.streetMatches)
  const fuzzy = exact
    ? null
    : uniqueFuzzyMatch(
        candidates.filter(
          (candidate) => candidate.cityMatches && candidate.zipMatches,
        ),
        targetStreet,
      )
  const best = exact ?? fuzzy
  if (!best) return null
  return {
    source: 'colorado-state-address-point',
    matchedAddress: best.attributes.AddrFull ?? '',
    city: best.attributes.PlaceName ?? null,
    zipCode: best.attributes.Zipcode ?? null,
    lat: best.lat,
    lng: best.lng,
    score: 'similarity' in best ? best.similarity * 100 : 100,
    matchType: fuzzy ? 'PointAddressFuzzyStreet' : 'PointAddress',
  }
}

async function officialGisLookup(
  address: Address,
): Promise<OfficialGisMatch | null> {
  try {
    if (normalizedCity(address.city) === 'larkspur') {
      return (
        (await douglasCountyAddress(address)) ??
        coloradoStateAddressPoint(address)
      )
    }
    return (
      (await coloradoSpringsAddressPoint(address)) ??
      coloradoStateAddressPoint(address)
    )
  } catch {
    return null
  }
}

async function photonAddressLookup(
  address: Address,
): Promise<PhotonMatch | null> {
  try {
    const params = new URLSearchParams({
      q: `${stripUnit(address.street_1)}, ${address.city}, ${address.state} ${address.zip_code}`,
      limit: '10',
      lang: 'en',
      bbox: '-105.35,38.6,-104.35,39.6',
    })
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'SasquatchCarpetCleaning/1.0 (address-repair-audit; +https://sasquatchcarpet.com)',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] }
        properties?: {
          housenumber?: string
          street?: string
          name?: string
          city?: string
          town?: string
          village?: string
          state?: string
          postcode?: string
        }
      }>
    }
    const targetNumber = streetNumber(address.street_1)
    const targetStreet = normalizedStreet(address.street_1)
    const candidate = (payload.features ?? []).find((feature) => {
      const properties = feature.properties ?? {}
      const candidateNumber = Number(properties.housenumber)
      const candidateRoad = properties.street ?? properties.name ?? ''
      const candidateCity =
        properties.city ?? properties.town ?? properties.village ?? ''
      const stateMatches =
        normalizedCity(properties.state ?? '') === 'colorado' ||
        normalizedCity(properties.state ?? '') === 'co'
      const cityMatches =
        normalizedCity(candidateCity) === normalizedCity(address.city)
      const zipMatches = properties.postcode === address.zip_code
      const coordinates = feature.geometry?.coordinates
      return (
        candidateNumber === targetNumber &&
        normalizedStreet(`${candidateNumber} ${candidateRoad}`) ===
          targetStreet &&
        stateMatches &&
        (cityMatches || zipMatches) &&
        Array.isArray(coordinates) &&
        Number.isFinite(Number(coordinates[0])) &&
        Number.isFinite(Number(coordinates[1]))
      )
    })
    if (!candidate?.geometry?.coordinates) return null
    const properties = candidate.properties ?? {}
    const [lng, lat] = candidate.geometry.coordinates
    return {
      matchedAddress:
        `${properties.housenumber ?? ''} ${properties.street ?? properties.name ?? ''}`.trim(),
      city: properties.city ?? properties.town ?? properties.village ?? null,
      zipCode: properties.postcode ?? null,
      lat: Number(lat),
      lng: Number(lng),
    }
  } catch {
    return null
  }
}

async function selectInChunks<T>(
  table: string,
  columns: string,
  field: string,
  values: string[],
): Promise<T[]> {
  const output: T[] = []
  for (let index = 0; index < values.length; index += 100) {
    const chunk = values.slice(index, index + 100)
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(field, chunk)
    if (error) throw error
    output.push(...((data ?? []) as T[]))
  }
  return output
}

async function censusBatch(addresses: Address[]): Promise<CensusBatchResult[]> {
  const csv = addresses
    .map((address) =>
      [
        address.id,
        stripUnit(address.street_1),
        address.city,
        address.state,
        address.zip_code,
      ]
        .map(csvEscape)
        .join(','),
    )
    .join('\n')

  const form = new FormData()
  form.set('benchmark', 'Public_AR_Current')
  form.set(
    'addressFile',
    new Blob([csv], { type: 'text/csv' }),
    'addresses.csv',
  )

  const response = await fetch(
    'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
    { method: 'POST', body: form },
  )
  if (!response.ok) {
    throw new Error(`Census batch geocoder returned HTTP ${response.status}`)
  }

  return parseCsv(await response.text()).map((row) => {
    // Census batch output is:
    // id, submitted address, match status, match type, matched address,
    // coordinates (lng,lat), TIGER line id, side.
    const [lngText, latText] = String(row[5] ?? '').split(',')
    const lng = Number(lngText)
    const lat = Number(latText)
    return {
      id: row[0] ?? '',
      status: row[2] ?? '',
      matchType: row[3] ?? '',
      matchedAddress: row[4] ?? '',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    }
  })
}

async function censusSingle(
  address: Address,
  variant: 'without-zip' | 'without-city',
): Promise<CensusSingleMatch | null> {
  const params = new URLSearchParams({
    street: stripUnit(address.street_1),
    state: address.state,
    benchmark: 'Public_AR_Current',
    format: 'json',
  })
  if (variant === 'without-zip') params.set('city', address.city)
  if (variant === 'without-city') params.set('zip', address.zip_code)

  const response = await fetch(
    `https://geocoding.geo.census.gov/geocoder/locations/address?${params}`,
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string
        coordinates?: { x?: number; y?: number }
        tigerLine?: { tigerLineId?: string }
      }>
    }
  }
  const match = payload.result?.addressMatches?.[0]
  const lat = Number(match?.coordinates?.y)
  const lng = Number(match?.coordinates?.x)
  if (
    !match?.matchedAddress ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null
  }
  return {
    matchedAddress: match.matchedAddress,
    lat,
    lng,
    tigerLineId: match.tigerLine?.tigerLineId ?? null,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await work(items[index])
      }
    },
  )
  await Promise.all(workers)
  return results
}

async function main() {
  const { data, error } = await supabase
    .from('ops_service_addresses')
    .select(
      'id, customer_id, street_1, street_2, city, state, zip_code, latitude, longitude',
    )
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(2000)
  if (error) throw error

  const addresses = ((data ?? []) as Address[]).filter((address) =>
    BAD_CENTERS.some(
      (center) =>
        address.latitude === center.lat && address.longitude === center.lng,
    ),
  )
  const addressIds = addresses.map((address) => address.id)
  const appointments = await selectInChunks<Appointment>(
    'ops_appointments',
    'id, service_address_id, status, appointment_date, gps_lat, gps_lng',
    'service_address_id',
    addressIds,
  )
  const appointmentIds = appointments.map((appointment) => appointment.id)
  const invoices = await selectInChunks<Invoice>(
    'ops_invoices',
    'id, appointment_id',
    'appointment_id',
    appointmentIds,
  )
  const jobs = await selectInChunks<Job>(
    'jobs',
    'id, ops_invoice_id, gps_lat, gps_lng',
    'ops_invoice_id',
    invoices.map((invoice) => invoice.id),
  )

  const appointmentsByAddress = new Map<string, Appointment[]>()
  for (const appointment of appointments) {
    if (!appointment.service_address_id) continue
    const list = appointmentsByAddress.get(appointment.service_address_id) ?? []
    list.push(appointment)
    appointmentsByAddress.set(appointment.service_address_id, list)
  }
  const invoiceByAppointment = new Map(
    invoices.map((invoice) => [invoice.appointment_id, invoice.id]),
  )
  const jobsByInvoice = new Map<string, Job[]>()
  for (const job of jobs) {
    if (!job.ops_invoice_id) continue
    const list = jobsByInvoice.get(job.ops_invoice_id) ?? []
    list.push(job)
    jobsByInvoice.set(job.ops_invoice_id, list)
  }

  const censusResults = await censusBatch(addresses)
  const censusById = new Map(censusResults.map((result) => [result.id, result]))
  const unmatchedAddresses = addresses.filter(
    (address) => censusById.get(address.id)?.status !== 'Match',
  )
  const fallbackMatches = await mapWithConcurrency(
    unmatchedAddresses,
    4,
    async (address) => {
      const withoutZip = await censusSingle(address, 'without-zip')
      if (withoutZip) {
        return {
          id: address.id,
          variant: 'without-zip' as const,
          match: withoutZip,
        }
      }
      const withoutCity = await censusSingle(address, 'without-city')
      return {
        id: address.id,
        variant: 'without-city' as const,
        match: withoutCity,
      }
    },
  )
  const fallbackById = new Map(
    fallbackMatches.map((result) => [result.id, result]),
  )
  const officialGisMatches = await mapWithConcurrency(
    addresses,
    8,
    async (address) => ({
      id: address.id,
      match: await officialGisLookup(address),
    }),
  )
  const officialGisById = new Map(
    officialGisMatches.map((result) => [result.id, result.match]),
  )
  const photonResearchAddresses = addresses.filter(
    (address) =>
      !officialGisById.get(address.id) &&
      censusById.get(address.id)?.status !== 'Match' &&
      !fallbackById.get(address.id)?.match,
  )
  const photonMatches = await mapWithConcurrency(
    photonResearchAddresses,
    2,
    async (address) => ({
      id: address.id,
      match: await photonAddressLookup(address),
    }),
  )
  const photonById = new Map(
    photonMatches.map((result) => [result.id, result.match]),
  )

  const audit = addresses.map((address) => {
    const internalPoints: Point[] = []
    for (const appointment of appointmentsByAddress.get(address.id) ?? []) {
      const appointmentPoint = finitePoint(
        appointment.gps_lat,
        appointment.gps_lng,
        `appointment:${appointment.id}`,
      )
      if (appointmentPoint) internalPoints.push(appointmentPoint)

      const invoiceId = invoiceByAppointment.get(appointment.id)
      for (const job of invoiceId ? (jobsByInvoice.get(invoiceId) ?? []) : []) {
        const jobPoint = finitePoint(job.gps_lat, job.gps_lng, `job:${job.id}`)
        if (jobPoint) internalPoints.push(jobPoint)
      }
    }

    const census = censusById.get(address.id) ?? null
    const fallback = fallbackById.get(address.id) ?? null
    const censusPoint = census
      ? finitePoint(census.lat, census.lng, 'census-batch')
      : null
    const fallbackPoint = fallback?.match
      ? finitePoint(
          fallback.match.lat,
          fallback.match.lng,
          `census-${fallback.variant}`,
        )
      : null
    const officialGis = officialGisById.get(address.id) ?? null
    const officialGisPoint = officialGis
      ? finitePoint(officialGis.lat, officialGis.lng, officialGis.source)
      : null
    const photon = photonById.get(address.id) ?? null
    const photonPoint = photon
      ? finitePoint(photon.lat, photon.lng, 'photon-street-match')
      : null
    const researchedPoint =
      officialGisPoint ?? censusPoint ?? fallbackPoint ?? photonPoint
    const closestInternalDistance =
      researchedPoint && internalPoints.length > 0
        ? Math.min(
            ...internalPoints.map((point) =>
              Math.round(distanceMeters(point, researchedPoint)),
            ),
          )
        : null

    return {
      address,
      contaminatedCenter:
        BAD_CENTERS.find(
          (center) =>
            address.latitude === center.lat && address.longitude === center.lng,
        )?.label ?? 'unknown',
      internalPoints,
      census,
      fallback,
      officialGis,
      photon,
      officialGisToCensusDistanceMeters:
        officialGisPoint && (censusPoint ?? fallbackPoint)
          ? Math.round(
              distanceMeters(officialGisPoint, censusPoint ?? fallbackPoint!),
            )
          : null,
      closestInternalDistanceMeters: closestInternalDistance,
      status:
        officialGisPoint &&
        internalPoints.length > 0 &&
        closestInternalDistance! <= 500
          ? 'official-gis-and-internal-gps-corroborated'
          : officialGisPoint && censusPoint
            ? 'official-gis-and-census-corroborated'
            : officialGisPoint
              ? 'official-gis-match'
              : researchedPoint &&
                  internalPoints.length > 0 &&
                  closestInternalDistance! <= 500
                ? 'census-and-internal-gps-corroborated'
                : censusPoint
                  ? 'census-match-needs-review'
                  : fallbackPoint
                    ? 'census-variant-needs-review'
                    : photonPoint
                      ? 'photon-street-match-needs-review'
                      : internalPoints.length > 0
                        ? 'internal-gps-needs-address-research'
                        : 'individual-research-required',
    }
  })

  const summary = audit.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1
    return counts
  }, {})

  const outputDirectory = path.join(process.cwd(), 'output')
  await mkdir(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, 'address-geocode-audit.json')
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, audit }, null, 2)}\n`,
    'utf8',
  )

  console.log(
    JSON.stringify(
      {
        contaminatedAddresses: addresses.length,
        censusMatches: censusResults.filter((result) => result.lat != null)
          .length,
        censusVariantMatches: fallbackMatches.filter((result) => result.match)
          .length,
        officialGisMatches: officialGisMatches.filter((result) => result.match)
          .length,
        photonMatches: photonMatches.filter((result) => result.match).length,
        withInternalGps: audit.filter((item) => item.internalPoints.length > 0)
          .length,
        summary,
        outputPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
