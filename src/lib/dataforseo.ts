/**
 * DataForSEO client — Google organic and Maps SERPs for rank tracking.
 *
 * Radar's auditable full-depth organic scan and both Maps fetchers use this
 * client. Other discovery/snippet utilities remain in serpApi.ts.
 *
 * Uses the `live/advanced` endpoint: synchronous, one request in one request
 * out. DataForSEO also offers a cheaper async standard queue (task_post +
 * task_get, ~3x less per call) but it requires polling and can take up to 45
 * minutes to resolve — not worth the complexity at this volume. A weekly
 * 150-point scan on live pricing is still under $0.30.
 */

import {
  normalizeDomain,
  TOWN_CENTROIDS,
  townKeyFromLocation,
} from '@/lib/serpApi'
import type {
  RadarDomain,
  SerpDomainWithPosition,
  SerpMapPackPlace,
  SerpMapsLocalFinder,
} from '@/lib/serpApi'

const BASE = 'https://api.dataforseo.com/v3'

/**
 * Zoom level for point scans.
 *
 * NOT the same value as SerpApi's MAPS_ZOOM (14) — that constant does not
 * transfer. Verified live: at zoom 14, DataForSEO's Maps endpoint returns only
 * 3 results regardless of the `depth` parameter (the visible-viewport area is
 * too small); zoom 13 returns 14; zoom 12 and below reliably return the full
 * 20. Anything beyond rank 3 would have silently read as "not found" at the
 * inherited zoom — this constant exists specifically to avoid that.
 */
export const DATAFORSEO_MAPS_ZOOM = 12

/** A real organic depth, crawled across result pages by DataForSEO. */
export const DATAFORSEO_ORGANIC_DEPTH = 50
export const DATAFORSEO_ORGANIC_DEVICE = 'desktop'
const DATAFORSEO_ORGANIC_RADIUS_METERS = 500

/**
 * `lat,lng,zoomz` — NOT `formatLl` from serpApi.ts, which prefixes an `@`
 * for SerpApi's `ll` param. Live-tested: DataForSEO rejects that prefix
 * outright ("Invalid Field: 'location_coordinate'").
 */
function locationCoordinate(lat: number, lng: number, zoom: number): string {
  return `${lat},${lng},${zoom}z`
}

export function auth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD is not set')
  }
  return Buffer.from(`${login}:${password}`).toString('base64')
}

export const DFS_BASE = BASE

/**
 * Generic DataForSEO POST. Every v3 endpoint takes an array of task objects and
 * returns `{ status_code, tasks: [{ status_code, result: [...] }] }`, so one
 * helper covers SERP, Business Data, Reviews, Keywords and AI Optimization.
 *
 * `softEmpty` matches status messages that mean "nothing found" rather than
 * "broken" — a sparse rural grid point or a business with no Q&A is a normal
 * empty result, not an error worth failing a whole sync over.
 */
export async function dfsPost<T = unknown>(
  path: string,
  task: Record<string, unknown>,
  opts: { softEmpty?: RegExp } = {},
): Promise<{ result: T[]; taskId: string | null; cost: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([task]),
  })

  const text = await res.text()
  let json: {
    status_code?: number
    status_message?: string
    cost?: number
    tasks?: Array<{
      id?: string
      status_code?: number
      status_message?: string
      cost?: number
      result?: T[] | null
    }>
  }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(
      `DataForSEO returned non-JSON (${res.status}) from ${path}: ${text.slice(0, 200)}`,
    )
  }

  if (!res.ok || json.status_code !== 20000) {
    throw new Error(
      `DataForSEO error on ${path}: ${json.status_message || text.slice(0, 200)}`,
    )
  }

  const t = json.tasks?.[0]
  const softEmpty = opts.softEmpty ?? /no results|no search results|not found/i
  if (t && t.status_code !== 20000 && t.status_code !== 20100) {
    if (softEmpty.test(t.status_message || '')) {
      return { result: [], taskId: t.id ?? null, cost: t.cost ?? 0 }
    }
    throw new Error(`DataForSEO task error on ${path}: ${t.status_message}`)
  }

  return {
    result: t?.result ?? [],
    taskId: t?.id ?? null,
    cost: t?.cost ?? json.cost ?? 0,
  }
}

type RawMapsItem = {
  rank_absolute?: number
  title?: string
  domain?: string
  url?: string
  rating?: { value?: number; votes_count?: number }
  address?: string
  place_id?: string
  latitude?: number
  longitude?: number
}

type RawOrganicItem = {
  type?: string
  rank_group?: number
  rank_absolute?: number
  page?: number
  domain?: string
  url?: string
  title?: string
}

type RawOrganicResult = {
  items?: RawOrganicItem[]
}

export type DataForSeoOrganicRank = {
  domain_id: string
  rank_position: number | null
}

export type DataForSeoOrganicRanks = {
  ranks: DataForSeoOrganicRank[]
  snapshot: SerpDomainWithPosition[]
  requestedDepth: number
  returnedDepth: number
  taskId: string | null
  cost: number
  device: typeof DATAFORSEO_ORGANIC_DEVICE
  lat: number
  lng: number
}

/**
 * Fetch an actual multi-page organic ranking from a fixed town-centre point.
 *
 * Google no longer honours the old `num=50` shortcut used by the SerpApi
 * scanner. DataForSEO's `depth` explicitly crawls result pages, and rank_group
 * is the organic-only position (rank_absolute also counts maps and other SERP
 * features, so it is not the number people mean by "organic rank").
 */
export async function fetchOrganicRanks(
  keyword: string,
  location: string,
  domains: RadarDomain[],
): Promise<DataForSeoOrganicRanks> {
  const centroid = TOWN_CENTROIDS[townKeyFromLocation(location)]
  if (!centroid) {
    throw new Error(
      `No centroid for "${location}" — add it to TOWN_CENTROIDS in serpApi.ts`,
    )
  }

  const { result, taskId, cost } = await dfsPost<RawOrganicResult>(
    '/serp/google/organic/live/advanced',
    {
      keyword: keyword.trim(),
      location_coordinate: `${centroid.lat},${centroid.lng},${DATAFORSEO_ORGANIC_RADIUS_METERS}`,
      language_code: 'en',
      device: DATAFORSEO_ORGANIC_DEVICE,
      depth: DATAFORSEO_ORGANIC_DEPTH,
    },
  )

  const organic = (result[0]?.items ?? []).filter(
    (item) => item.type === 'organic' && (item.rank_group ?? 0) > 0,
  )
  const returnedDepth = organic.reduce(
    (max, item) => Math.max(max, item.rank_group ?? 0),
    0,
  )

  const domainMap = new Map(
    domains.map((domain) => [
      domain.domain.toLowerCase().replace(/^www\./, ''),
      domain.id,
    ]),
  )
  const found = new Set<string>()
  const ranks: DataForSeoOrganicRank[] = []
  const snapshot: SerpDomainWithPosition[] = []

  for (const item of organic) {
    const position = item.rank_group ?? 0
    const normalized = normalizeDomain(item.url ?? item.domain ?? '')
    if (!position || !normalized) continue

    snapshot.push({ domain: normalized, position })
    const domainId = domainMap.get(normalized)
    if (domainId && !found.has(domainId)) {
      found.add(domainId)
      ranks.push({ domain_id: domainId, rank_position: position })
    }
  }

  for (const domain of domains) {
    if (!found.has(domain.id)) {
      ranks.push({ domain_id: domain.id, rank_position: null })
    }
  }

  return {
    ranks,
    snapshot,
    requestedDepth: DATAFORSEO_ORGANIC_DEPTH,
    returnedDepth,
    taskId,
    cost,
    device: DATAFORSEO_ORGANIC_DEVICE,
    lat: centroid.lat,
    lng: centroid.lng,
  }
}

async function mapsSearch(
  keyword: string,
  coordinate: string,
  depth = 20,
): Promise<RawMapsItem[]> {
  const res = await fetch(`${BASE}/serp/google/maps/live/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        keyword: keyword.trim(),
        location_coordinate: coordinate,
        language_code: 'en',
        device: 'desktop',
        depth,
      },
    ]),
  })

  const text = await res.text()
  let json: {
    status_code?: number
    status_message?: string
    tasks?: Array<{
      status_code?: number
      status_message?: string
      result?: Array<{ items?: RawMapsItem[] }>
    }>
  }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(
      `DataForSEO returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
    )
  }

  if (!res.ok || json.status_code !== 20000) {
    throw new Error(
      `DataForSEO error: ${json.status_message || text.slice(0, 200)}`,
    )
  }
  const task = json.tasks?.[0]
  if (task && task.status_code !== 20000) {
    // "no results" for a sparse rural point is a normal empty case.
    if (/no results|no search results/i.test(task.status_message || ''))
      return []
    throw new Error(`DataForSEO task error: ${task.status_message}`)
  }
  return task?.result?.[0]?.items ?? []
}

function toPlace(item: RawMapsItem): SerpMapPackPlace | null {
  const pos = item.rank_absolute ?? 0
  if (!pos) return null
  return {
    position: pos,
    title: (item.title ?? '').trim() || null,
    domain: item.url
      ? normalizeDomain(item.url)
      : item.domain
        ? normalizeDomain(item.domain)
        : null,
    rating: item.rating?.value ?? null,
    reviews: item.rating?.votes_count ?? null,
    address: (item.address ?? '').trim() || null,
    place_id: item.place_id ?? null,
    lat: item.latitude ?? null,
    lng: item.longitude ?? null,
  }
}

/** Match by domain first, then loose name containment — same rule SerpApi uses. */
function matchPlaceToDomainId(
  place: { title?: string | null; domain?: string | null },
  domains: RadarDomain[],
): string | null {
  if (place.domain) {
    const hostNorm = place.domain.toLowerCase().replace(/^www\./, '')
    const byDomain = domains.find(
      (d) => d.domain.toLowerCase().replace(/^www\./, '') === hostNorm,
    )
    if (byDomain) return byDomain.id
  }
  const placeNorm = (place.title ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!placeNorm) return null
  for (const d of domains) {
    const displayNorm = (d.display_name ?? d.domain)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
    if (!displayNorm) continue
    if (placeNorm === displayNorm) return d.id
    if (placeNorm.includes(displayNorm) || displayNorm.includes(placeNorm))
      return d.id
  }
  return null
}

/**
 * Fetch the Maps local pack from ONE geographic point. Same contract as
 * `fetchMapsAtPoint` in serpApi.ts — drop-in replacement.
 */
export async function fetchMapsAtPoint(
  keyword: string,
  lat: number,
  lng: number,
  zoom = DATAFORSEO_MAPS_ZOOM,
): Promise<SerpMapPackPlace[]> {
  const items = await mapsSearch(keyword, locationCoordinate(lat, lng, zoom))
  const out: SerpMapPackPlace[] = []
  for (const item of items) {
    const place = toPlace(item)
    if (place) out.push(place)
  }
  return out
}

/**
 * Fetch the Maps local pack for a named town/keyword pair. Same contract as
 * `fetchMapsLocalFinder` in serpApi.ts.
 *
 * Live-tested and reverted from `location_name` free text: DataForSEO
 * rejected it outright ("Invalid Field: 'location_name'") — it needs a value
 * from their own location taxonomy, not an arbitrary "Town, State, Country"
 * string. Using the town centroid coordinate instead is both simpler (reuses
 * TOWN_CENTROIDS from the grid work) and more precise than a geocoder guess.
 */
export async function fetchMapsLocalFinder(
  keyword: string,
  location: string,
  domains: RadarDomain[],
): Promise<SerpMapsLocalFinder> {
  const centroid = TOWN_CENTROIDS[townKeyFromLocation(location)]
  if (!centroid) {
    throw new Error(
      `No centroid for "${location}" — add it to TOWN_CENTROIDS in serpApi.ts`,
    )
  }

  const items = await mapsSearch(
    keyword,
    locationCoordinate(centroid.lat, centroid.lng, DATAFORSEO_MAPS_ZOOM),
  )

  const mapPack: SerpMapPackPlace[] = []
  const ranksByDomainId = new Map<string, number>()

  for (const item of items) {
    const place = toPlace(item)
    if (!place) continue
    mapPack.push(place)
    const domainId = matchPlaceToDomainId(place, domains)
    if (domainId && !ranksByDomainId.has(domainId)) {
      ranksByDomainId.set(domainId, place.position)
    }
  }

  return { mapPack, ranksByDomainId }
}
