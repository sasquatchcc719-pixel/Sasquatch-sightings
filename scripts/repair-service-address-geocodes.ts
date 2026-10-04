/**
 * Repair service-address coordinates that were previously set to a city center.
 *
 * Dry run (default): pnpm exec tsx scripts/repair-service-address-geocodes.ts
 * Apply verified candidates: pnpm exec tsx scripts/repair-service-address-geocodes.ts --apply
 *
 * This script never updates customer address text. It only changes latitude,
 * longitude, geocode_source, geocoded_at, and updated_at, and only while the
 * row still contains the contaminated coordinate found by the audit.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { readFile, writeFile } from 'node:fs/promises'
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

type Point = { lat: number; lng: number; source?: string }
type AuditItem = {
  address: {
    id: string
    street_1: string
    city: string
    state: string
    zip_code: string
    latitude: number
    longitude: number
  }
  internalPoints: Point[]
  census: {
    status: string
    matchType: string
    matchedAddress: string
    lat: number | null
    lng: number | null
  } | null
  fallback: {
    variant: string
    match: {
      matchedAddress: string
      lat: number
      lng: number
    } | null
  } | null
  officialGis: {
    source: string
    matchedAddress: string
    lat: number
    lng: number
    matchType: string | null
  } | null
  photon: {
    matchedAddress: string
    lat: number
    lng: number
  } | null
}

type RepairCandidate = {
  id: string
  previousLat: number
  previousLng: number
  lat: number
  lng: number
  source: string
}

type ResearchCandidate = {
  matchedAddress: string
  city: string | null
  zipCode: string | null
  lat: number
  lng: number
  similarity: number
}

type ResearchResult = {
  id: string
  candidates: ResearchCandidate[]
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

function stripUnit(street: string): string {
  return street
    .replace(
      /\s*(?:,\s*)?(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+.*$/i,
      '',
    )
    .trim()
}

function normalizedStreet(street: string): string {
  return stripUnit(street)
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TOKEN_ALIASES[token] ?? token)
    .join(' ')
}

function streetNumber(street: string): string {
  return (
    stripUnit(street)
      .match(/^\s*(\d+[a-z]?)/i)?.[1]
      ?.toLowerCase() ?? ''
  )
}

function finitePoint(
  point:
    | { lat: number | string | null; lng: number | string | null }
    | null
    | undefined,
): point is Point {
  return (
    !!point &&
    Number.isFinite(Number(point.lat)) &&
    Number.isFinite(Number(point.lng)) &&
    Number(point.lat) >= 36.8 &&
    Number(point.lat) <= 41.2 &&
    Number(point.lng) >= -109.2 &&
    Number(point.lng) <= -101.8
  )
}

function matchedAddressAgrees(
  item: AuditItem,
  matchedAddress: string,
): boolean {
  const matchedStreet = matchedAddress.split(',')[0] ?? ''
  return (
    streetNumber(matchedStreet) === streetNumber(item.address.street_1) &&
    normalizedStreet(matchedStreet) === normalizedStreet(item.address.street_1)
  )
}

function normalizedLocality(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function censusCity(matchedAddress: string): string {
  const parts = matchedAddress
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const stateIndex = parts.findIndex((part) => /^CO$/i.test(part))
  return stateIndex > 0 ? parts[stateIndex - 1] : ''
}

function censusAddressAgrees(item: AuditItem): boolean {
  if (!item.census) return false
  const matchedStreet = item.census.matchedAddress.split(',')[0] ?? ''
  return (
    streetNumber(matchedStreet) === streetNumber(item.address.street_1) &&
    normalizedLocality(censusCity(item.census.matchedAddress)) ===
      normalizedLocality(item.address.city)
  )
}

function distanceMeters(left: Point, right: Point): number {
  const earthRadiusMeters = 6_371_000
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const latitudeDelta = radians(right.lat - left.lat)
  const longitudeDelta = radians(right.lng - left.lng)
  const latitudeA = radians(left.lat)
  const latitudeB = radians(right.lat)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
}

function researchedPoint(
  result: ResearchResult | undefined,
): ResearchCandidate | null {
  const [first, second] = result?.candidates ?? []
  if (!first || !finitePoint(first)) return null

  const isUniqueHighConfidence =
    first.similarity >= 0.7 &&
    (!second || first.similarity - second.similarity >= 0.05)
  const isSameBuildingTie =
    first.similarity >= 0.6 &&
    !!second &&
    finitePoint(second) &&
    distanceMeters(first, second) <= 25

  return isUniqueHighConfidence || isSameBuildingTie ? first : null
}

function internalMedoid(points: Point[]): Point | null {
  const valid = points.filter(finitePoint)
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]
  const distanceSquared = (a: Point, b: Point) =>
    (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2
  return valid.reduce((best, candidate) => {
    const candidateDistance = valid.reduce(
      (sum, point) => sum + distanceSquared(candidate, point),
      0,
    )
    const bestDistance = valid.reduce(
      (sum, point) => sum + distanceSquared(best, point),
      0,
    )
    return candidateDistance < bestDistance ? candidate : best
  })
}

function candidateFor(
  item: AuditItem,
  researchById: Map<string, ResearchResult>,
): RepairCandidate | null {
  let point: Point | null = null
  let source = ''

  if (finitePoint(item.officialGis)) {
    point = item.officialGis
    source = `repair:${item.officialGis.source}`
  } else if (
    item.census?.status === 'Match' &&
    item.census.matchType === 'Exact' &&
    finitePoint(item.census)
  ) {
    point = item.census
    source = 'repair:census-exact'
  } else if (
    item.census?.status === 'Match' &&
    (matchedAddressAgrees(item, item.census.matchedAddress) ||
      censusAddressAgrees(item)) &&
    finitePoint(item.census)
  ) {
    point = item.census
    source = 'repair:census-non-exact'
  } else if (
    item.fallback?.match &&
    matchedAddressAgrees(item, item.fallback.match.matchedAddress) &&
    finitePoint(item.fallback.match)
  ) {
    point = item.fallback.match
    source = `repair:census-${item.fallback.variant}`
  } else if (
    item.photon &&
    matchedAddressAgrees(item, item.photon.matchedAddress) &&
    finitePoint(item.photon)
  ) {
    point = item.photon
    source = 'repair:photon-street-verified'
  } else {
    point = researchedPoint(researchById.get(item.address.id))
    source = point ? 'repair:colorado-state-manual-research' : ''
    if (!point) {
      point = internalMedoid(item.internalPoints)
      source = point ? 'repair:onsite-gps' : ''
    }
  }

  if (!point || !source) return null
  if (
    Number(point.lat) === Number(item.address.latitude) &&
    Number(point.lng) === Number(item.address.longitude)
  ) {
    return null
  }
  return {
    id: item.address.id,
    previousLat: Number(item.address.latitude),
    previousLng: Number(item.address.longitude),
    lat: Number(point.lat),
    lng: Number(point.lng),
    source,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

async function main() {
  const auditPath = path.join(
    process.cwd(),
    'output/address-geocode-audit.json',
  )
  const payload = JSON.parse(await readFile(auditPath, 'utf8')) as {
    generatedAt: string
    audit: AuditItem[]
  }
  const researchPath = path.join(
    process.cwd(),
    'output/unresolved-address-research.json',
  )
  const researchPayload = JSON.parse(await readFile(researchPath, 'utf8')) as {
    researchResults: ResearchResult[]
  }
  const researchById = new Map(
    researchPayload.researchResults.map((result) => [result.id, result]),
  )
  const candidates = payload.audit
    .map((item) => candidateFor(item, researchById))
    .filter((candidate): candidate is RepairCandidate => !!candidate)
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const unresolved = payload.audit
    .filter((item) => !candidateIds.has(item.address.id))
    .map((item) => item.address.id)
  const bySource = candidates.reduce<Record<string, number>>((counts, item) => {
    counts[item.source] = (counts[item.source] ?? 0) + 1
    return counts
  }, {})

  const repairPlanPath = path.join(
    process.cwd(),
    'output/address-geocode-repair-plan.json',
  )
  await writeFile(
    repairPlanPath,
    `${JSON.stringify({ auditGeneratedAt: payload.generatedAt, candidates, unresolved }, null, 2)}\n`,
    'utf8',
  )

  const apply = process.argv.includes('--apply')
  let updated = 0
  let skipped = 0
  if (apply) {
    const results = await mapWithConcurrency(
      candidates,
      8,
      async (candidate) => {
        const now = new Date().toISOString()
        const { data, error } = await supabase
          .from('ops_service_addresses')
          .update({
            latitude: candidate.lat,
            longitude: candidate.lng,
            geocode_source: candidate.source,
            geocoded_at: now,
            updated_at: now,
          })
          .eq('id', candidate.id)
          .eq('latitude', candidate.previousLat)
          .eq('longitude', candidate.previousLng)
          .select('id')
        if (error) throw error
        return (data ?? []).length === 1
      },
    )
    updated = results.filter(Boolean).length
    skipped = results.length - updated
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'apply' : 'dry-run',
        audited: payload.audit.length,
        repairCandidates: candidates.length,
        unresolved: unresolved.length,
        bySource,
        updated,
        skipped,
        repairPlanPath,
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
