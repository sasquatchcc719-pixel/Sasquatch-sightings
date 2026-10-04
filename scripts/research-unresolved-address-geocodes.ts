/** Find canonical Colorado address-point candidates for audit exceptions. */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type AuditItem = {
  status: string
  address: {
    id: string
    street_1: string
    city: string
    zip_code: string
  }
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
  point: 'pt',
  road: 'rd',
  south: 's',
  southeast: 'se',
  southwest: 'sw',
  street: 'st',
  terrace: 'ter',
  trail: 'trl',
  west: 'w',
}

function stripUnit(value: string): string {
  return value
    .replace(
      /\s*(?:,\s*)?(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+.*$/i,
      '',
    )
    .trim()
}

function normalizedStreet(value: string): string {
  return stripUnit(value)
    .toLowerCase()
    .replace(/^\s*\d+[a-z]?\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => STREET_TOKEN_ALIASES[token] ?? token)
    .join(' ')
}

function streetNumber(value: string): string | null {
  return stripUnit(value).match(/^\s*(\d+[a-z]?)/i)?.[1] ?? null
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

function similarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  return (
    1 - levenshteinDistance(left, right) / Math.max(left.length, right.length)
  )
}

async function research(item: AuditItem) {
  const number = streetNumber(item.address.street_1)
  if (!number) return { id: item.address.id, candidates: [] }
  const params = new URLSearchParams({
    where: `AddrNum = '${number.replaceAll("'", "''")}'`,
    outFields: 'AddrFull,PlaceName,Zipcode,Latitude,Longitude',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  })
  const response = await fetch(
    `https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Addresses/FeatureServer/0/query?${params}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!response.ok) return { id: item.address.id, candidates: [] }
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
  const targetStreet = normalizedStreet(item.address.street_1)
  const candidates = (payload.features ?? [])
    .map((feature) => {
      const attributes = feature.attributes ?? {}
      const candidateStreet = normalizedStreet(attributes.AddrFull ?? '')
      return {
        matchedAddress: attributes.AddrFull ?? '',
        city: attributes.PlaceName ?? null,
        zipCode: attributes.Zipcode ?? null,
        lat: Number(feature.geometry?.y ?? attributes.Latitude),
        lng: Number(feature.geometry?.x ?? attributes.Longitude),
        similarity: similarity(targetStreet, candidateStreet),
      }
    })
    .filter(
      (candidate) =>
        Number.isFinite(candidate.lat) &&
        Number.isFinite(candidate.lng) &&
        candidate.lat >= 38.6 &&
        candidate.lat <= 39.6 &&
        candidate.lng >= -105.35 &&
        candidate.lng <= -104.35,
    )
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 5)
  return { id: item.address.id, candidates }
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
    audit: AuditItem[]
  }
  const unresolved = payload.audit.filter(
    (item) => item.status === 'individual-research-required',
  )
  const researchResults = await mapWithConcurrency(unresolved, 8, research)
  const outputPath = path.join(
    process.cwd(),
    'output/unresolved-address-research.json',
  )
  await writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), researchResults }, null, 2)}\n`,
    'utf8',
  )

  const withCandidates = researchResults.filter(
    (result) => result.candidates.length > 0,
  )
  const uniqueHighConfidence = withCandidates.filter((result) => {
    const [first, second] = result.candidates
    return (
      first.similarity >= 0.7 &&
      (!second || first.similarity - second.similarity >= 0.05)
    )
  })
  console.log(
    JSON.stringify(
      {
        unresolved: unresolved.length,
        withCandidates: withCandidates.length,
        uniqueHighConfidence: uniqueHighConfidence.length,
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
