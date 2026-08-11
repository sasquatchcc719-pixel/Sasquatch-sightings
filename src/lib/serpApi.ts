/**
 * SerpApi Google Search integration for Radar (competitor SERP tracking).
 * Fetches top N organic results; domains not in top N get rank N. num=50 balances
 * accuracy (see real ranks 21–50) with credits. Uses gl/hl for US English.
 */

import { fetchSerpApiJson } from '@/lib/serpapi-budget'

export type SerpApiOrganicResult = {
  position: number
  link: string
  title?: string
  displayed_link?: string
}

export type SerpApiRankResult = {
  domain_id: string
  rank_position: number
  /** Local Map Pack position when present; null if not in pack */
  map_rank: number | null
}

export type RadarDomain = {
  id: string
  domain: string
  display_name: string | null
  is_my_domain: boolean
}

/**
 * Normalize a URL to a comparable domain (lowercase, no www).
 */
export function normalizeDomain(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    const host = u.hostname.toLowerCase()
    return host.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Normalize for business-name matching: lower, trim, collapse spaces. */
function normalizeName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Match a local pack place to a tracked domain: by website domain or by business name.
 */
function matchPlaceToDomainId(
  place: { title?: string; links?: { website?: string } },
  domains: RadarDomain[],
): string | null {
  const website = place.links?.website
  if (website) {
    const hostNorm = normalizeDomain(website)
    if (hostNorm) {
      const d = domains.find(
        (x) => x.domain.toLowerCase().replace(/^www\./, '') === hostNorm,
      )
      if (d) return d.id
    }
  }
  const placeTitle = (place.title ?? '').trim()
  if (!placeTitle) return null
  const placeNorm = normalizeName(placeTitle)
  for (const d of domains) {
    const displayNorm = normalizeName(d.display_name ?? d.domain)
    if (!displayNorm) continue
    if (placeNorm === displayNorm) return d.id
    if (placeNorm.includes(displayNorm) || displayNorm.includes(placeNorm))
      return d.id
  }
  return null
}

const SERP_NUM_RESULTS = 50
// Sentinel written to radar_rankings.rank_position when a domain isn't found in
// the organic results at all. It is NOT a real rank — anything reading that
// column must treat >= this value as "unranked", so it's exported rather than
// re-hardcoded at each call site.
export const NOT_FOUND_RANK = SERP_NUM_RESULTS

export type SerpMapPackPlace = {
  position: number
  title: string | null
  domain: string | null
  rating: number | null
  reviews: number | null
  address: string | null
  /** Google's permanent ID for the place — survives renames and missing websites. */
  place_id: string | null
  lat: number | null
  lng: number | null
}

/**
 * Fixed centroids for the towns Radar tracks.
 *
 * Why hardcoded: `engine=google_maps` needs an explicit `ll` origin, otherwise
 * Google infers a location from the query text and the origin silently drifts
 * between calls — which makes "distance from town" undefined and ranks jumpy.
 * These are stable public coordinates (same set the marketing site's service-area
 * map uses), so no geocoding service is involved. Keys are normalized town names.
 */
export const TOWN_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  'palmer lake': { lat: 39.1152, lng: -104.9178 },
  monument: { lat: 39.0908, lng: -104.8698 },
  woodmoor: { lat: 39.0502, lng: -104.8606 },
  gleneagle: { lat: 39.0169, lng: -104.8473 },
  larkspur: { lat: 39.2356, lng: -104.8939 },
  'castle pines': { lat: 39.28, lng: -104.87 },
  'castle rock': { lat: 39.3722, lng: -104.8561 },
  'black forest': { lat: 38.9786, lng: -104.685 },
  'flying horse': { lat: 38.9603, lng: -104.8012 },
  falcon: { lat: 38.9378, lng: -104.6214 },
  'colorado springs': { lat: 38.8339, lng: -104.8214 },
}

/** Default Maps zoom for local-intent searches. */
export const MAPS_ZOOM = 14

/** "monument, Colorado, United States" → "monument" */
export function townKeyFromLocation(location: string): string {
  return location
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** SerpApi wants `@lat,lng,zoomz`. */
export function formatLl(lat: number, lng: number, zoom = MAPS_ZOOM): string {
  return `@${lat},${lng},${zoom}z`
}

export type SerpRanksWithSnapshot = {
  ranks: SerpApiRankResult[]
  /** Full SERP order (who’s #1, #2, …) so we can show it even if not on our list */
  snapshot: SerpDomainWithPosition[]
  /** Full Maps local pack (every place, not just tracked domains) with review counts */
  mapPack: SerpMapPackPlace[]
}

/**
 * Fetch Google search results from SerpApi. Returns ranks for tracked domains
 * and the full organic snapshot (domain + position) from the same call.
 */
export async function fetchSerpRanks(
  keyword: string,
  location: string,
  domains: RadarDomain[],
): Promise<SerpRanksWithSnapshot> {
  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location,
    num: String(SERP_NUM_RESULTS),
    gl: 'us',
    hl: 'en',
  })

  const data = await fetchSerpApiJson<{
    organic_results?: Array<{ position?: number; link?: string }>
    local_results?: {
      places?: Array<{
        position?: number
        title?: string
        rating?: number
        reviews?: number
        address?: string
        links?: { website?: string }
      }>
    }
    error?: string
  }>({
    source: 'radar-web-rank',
    query: `${keyword} | ${location}`,
    params,
  })

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`)
  }

  const places = data.local_results?.places ?? []

  const localDataByDomain = new Map<
    string,
    { rating: number; reviews: number; address?: string }
  >()
  const mapPackByDomainId = new Map<string, number>()
  const mapPack: SerpMapPackPlace[] = []
  for (const place of places) {
    const pos = place.position ?? 0
    if (!pos) continue
    const domainId = matchPlaceToDomainId(place, domains)
    if (domainId) mapPackByDomainId.set(domainId, pos)
    const website = place.links?.website
    const placeDomain = website ? normalizeDomain(website) : null
    mapPack.push({
      position: pos,
      title: (place.title ?? '').trim() || null,
      domain: placeDomain,
      rating: place.rating ?? null,
      reviews: place.reviews ?? null,
      address: (place.address ?? '').trim() || null,
      // The web 3-pack payload carries neither of these; only the Maps engine does.
      place_id: null,
      lat: null,
      lng: null,
    })
    if (website && place.rating != null) {
      const hostNorm = placeDomain
      if (hostNorm)
        localDataByDomain.set(hostNorm, {
          rating: place.rating,
          reviews: place.reviews ?? 0,
          ...(place.address &&
            place.address.trim() && { address: place.address.trim() }),
        })
    }
  }

  const organic = data.organic_results ?? []
  const domainMap = new Map<string, string>()
  for (const d of domains) {
    const norm = d.domain.toLowerCase().replace(/^www\./, '')
    domainMap.set(norm, d.id)
  }

  const ranks: SerpApiRankResult[] = []
  const found = new Set<string>()
  const snapshot: SerpDomainWithPosition[] = []

  for (const item of organic) {
    const link = item.link
    const pos = item.position ?? 0
    if (!link || !pos) continue

    const hostNorm = normalizeDomain(link)
    if (!hostNorm) continue

    const local = localDataByDomain.get(hostNorm)
    snapshot.push({
      domain: hostNorm,
      position: pos,
      ...(local && {
        rating: local.rating,
        reviews: local.reviews,
        ...(local.address && { address: local.address }),
      }),
    })

    const domainId = domainMap.get(hostNorm)
    if (domainId && !found.has(domainId)) {
      found.add(domainId)
      ranks.push({
        domain_id: domainId,
        rank_position: pos,
        map_rank: mapPackByDomainId.get(domainId) ?? null,
      })
    }
  }

  for (const d of domains) {
    if (!found.has(d.id)) {
      ranks.push({
        domain_id: d.id,
        rank_position: NOT_FOUND_RANK,
        map_rank: mapPackByDomainId.get(d.id) ?? null,
      })
    }
  }

  return { ranks, snapshot, mapPack }
}

/** How deep into the Maps local finder we track. Google returns ~20 per page. */
const MAPS_NUM_RESULTS = 20

export type SerpMapsLocalFinder = {
  /** Full ranked local-finder list (every place), capped at MAPS_NUM_RESULTS */
  mapPack: SerpMapPackPlace[]
  /** Local-finder position for each tracked domain that appears in the list */
  ranksByDomainId: Map<string, number>
}

/**
 * Fetch the full Google Maps local-finder ranking for a keyword — the deep,
 * scrollable list (top ~20) behind the 3-pack. Unlike the web 3-pack, this lets
 * us see real positions like #7 and track daily movement below the top 3.
 *
 * The google_maps engine targets by query text (it ignores the `location`
 * param, and we intentionally avoid geocoding), so the town is folded into `q`.
 */
export async function fetchMapsLocalFinder(
  keyword: string,
  location: string,
  domains: RadarDomain[],
): Promise<SerpMapsLocalFinder> {
  // "monument, Colorado, United States" → "monument, Colorado" so the query
  // reads naturally as "carpet cleaning monument, Colorado".
  const area = location
    .replace(/,\s*United States\s*$/i, '')
    .replace(/\s+,/g, ',')
    .trim()

  const params = new URLSearchParams({
    engine: 'google_maps',
    type: 'search',
    q: `${keyword} ${area}`.trim(),
    gl: 'us',
    hl: 'en',
  })

  // Pin the search origin. Without `ll` Google infers a location from the query
  // text, so the origin drifts between calls and distances have no fixed
  // reference. Falls back to text-only inference for any town we lack a centroid for.
  const centroid = TOWN_CENTROIDS[townKeyFromLocation(location)]
  if (centroid) params.set('ll', formatLl(centroid.lat, centroid.lng))

  const data = await fetchSerpApiJson<{
    local_results?: Array<{
      position?: number
      title?: string
      rating?: number
      reviews?: number
      address?: string
      website?: string
      place_id?: string
      gps_coordinates?: { latitude?: number; longitude?: number }
      links?: { website?: string }
    }>
    error?: string
  }>({
    source: 'radar-maps-local-finder',
    query: `${keyword} | ${area}`,
    params,
  })

  if (data.error) {
    // "no results" for a town is a normal empty case, not a hard failure.
    if (/didn'?t return|hasn'?t returned|no results/i.test(data.error)) {
      return { mapPack: [], ranksByDomainId: new Map() }
    }
    throw new Error(`SerpApi maps error: ${data.error}`)
  }

  const results = data.local_results ?? []
  const mapPack: SerpMapPackPlace[] = []
  const ranksByDomainId = new Map<string, number>()

  for (const place of results) {
    const pos = place.position ?? 0
    if (!pos || pos > MAPS_NUM_RESULTS) continue
    const website = place.website ?? place.links?.website
    const placeDomain = website ? normalizeDomain(website) : null
    mapPack.push({
      position: pos,
      title: (place.title ?? '').trim() || null,
      domain: placeDomain,
      rating: place.rating ?? null,
      reviews: place.reviews ?? null,
      address: (place.address ?? '').trim() || null,
      place_id: place.place_id ?? null,
      lat: place.gps_coordinates?.latitude ?? null,
      lng: place.gps_coordinates?.longitude ?? null,
    })
    // Match by website or business name (Maps often omits the website URL, so
    // name matching against display_name carries the load here).
    const domainId = matchPlaceToDomainId(
      { title: place.title, links: { website } },
      domains,
    )
    if (domainId && !ranksByDomainId.has(domainId)) {
      ranksByDomainId.set(domainId, pos)
    }
  }

  return { mapPack, ranksByDomainId }
}

/**
 * Fetch the Maps local finder from ONE geographic point.
 *
 * This is the primitive behind the geo-grid ("Local Falcon style") scan: the
 * same keyword is asked from many coordinates, and the rank of our business is
 * recorded at each one. Unlike `fetchMapsLocalFinder` the town name is NOT put
 * in the query — the coordinate alone defines where the searcher is standing,
 * which is the whole point.
 */
export async function fetchMapsAtPoint(
  keyword: string,
  lat: number,
  lng: number,
  zoom = MAPS_ZOOM,
): Promise<SerpMapPackPlace[]> {
  const params = new URLSearchParams({
    engine: 'google_maps',
    type: 'search',
    q: keyword.trim(),
    ll: formatLl(lat, lng, zoom),
    gl: 'us',
    hl: 'en',
  })

  const data = await fetchSerpApiJson<{
    local_results?: Array<{
      position?: number
      title?: string
      rating?: number
      reviews?: number
      address?: string
      website?: string
      place_id?: string
      gps_coordinates?: { latitude?: number; longitude?: number }
      links?: { website?: string }
    }>
    error?: string
  }>({
    source: 'radar-grid-point',
    query: `${keyword} | ${lat.toFixed(4)},${lng.toFixed(4)}`,
    params,
  })

  if (data.error) {
    if (/didn'?t return|hasn'?t returned|no results/i.test(data.error)) return []
    throw new Error(`SerpApi maps error: ${data.error}`)
  }

  const out: SerpMapPackPlace[] = []
  for (const place of data.local_results ?? []) {
    const pos = place.position ?? 0
    if (!pos || pos > MAPS_NUM_RESULTS) continue
    const website = place.website ?? place.links?.website
    out.push({
      position: pos,
      title: (place.title ?? '').trim() || null,
      domain: website ? normalizeDomain(website) : null,
      rating: place.rating ?? null,
      reviews: place.reviews ?? null,
      address: (place.address ?? '').trim() || null,
      place_id: place.place_id ?? null,
      lat: place.gps_coordinates?.latitude ?? null,
      lng: place.gps_coordinates?.longitude ?? null,
    })
  }
  return out
}

export type SerpDomainWithPosition = {
  domain: string
  position: number
  rating?: number
  reviews?: number
  address?: string
}

/**
 * Fetch organic results for a keyword and return domains with their Google position.
 * Use this to see who's actually ranking #1–10 (or add them to track). Uses gl/hl for US English.
 */
export async function fetchSerpDomains(
  keyword: string,
  location: string,
): Promise<SerpDomainWithPosition[]> {
  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location,
    num: String(SERP_NUM_RESULTS),
    gl: 'us',
    hl: 'en',
  })

  const data = await fetchSerpApiJson<{
    organic_results?: Array<{ position?: number; link?: string }>
    error?: string
  }>({
    source: 'radar-discover',
    query: `${keyword} | ${location}`,
    params,
  })

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`)
  }

  const organic = data.organic_results ?? []
  const seen = new Set<string>()
  const results: SerpDomainWithPosition[] = []

  for (const item of organic) {
    const link = item.link
    const position = item.position ?? 0
    if (!link || !position) continue
    const hostNorm = normalizeDomain(link)
    if (!hostNorm || seen.has(hostNorm)) continue
    seen.add(hostNorm)
    results.push({ domain: hostNorm, position })
  }

  return results
}

export type SerpSnippet = { title: string; snippet: string }

/**
 * Run a single SerpApi search and return organic titles + snippets.
 * Used for competitor dossier deep-dive (web search context).
 */
export async function fetchSerpSnippets(
  query: string,
  location = 'Colorado Springs, Colorado, United States',
): Promise<SerpSnippet[]> {
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    location,
    num: '10',
    gl: 'us',
    hl: 'en',
  })

  const data = await fetchSerpApiJson<{
    organic_results?: Array<{ title?: string; snippet?: string }>
    error?: string
  }>({
    source: 'radar-dossier-snippets',
    query: `${query} | ${location}`,
    params,
  })

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`)
  }

  const organic = data.organic_results ?? []
  const snippets: SerpSnippet[] = []
  for (const item of organic) {
    const title = (item.title ?? '').trim()
    const snippet = (item.snippet ?? '').trim()
    if (title || snippet) {
      snippets.push({ title, snippet })
    }
  }
  return snippets
}
