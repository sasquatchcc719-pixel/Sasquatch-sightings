/**
 * SerpApi Google Search integration for Radar (competitor SERP tracking).
 * Fetches top N organic results; domains not in top N get rank N. num=50 balances
 * accuracy (see real ranks 21–50) with credits. Uses gl/hl for US English.
 */

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
function normalizeDomain(url: string): string | null {
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
const NOT_FOUND_RANK = SERP_NUM_RESULTS

export type SerpRanksWithSnapshot = {
  ranks: SerpApiRankResult[]
  /** Full SERP order (who’s #1, #2, …) so we can show it even if not on our list */
  snapshot: SerpDomainWithPosition[]
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
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY is not set')
  }

  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location,
    num: String(SERP_NUM_RESULTS),
    gl: 'us',
    hl: 'en',
    api_key: apiKey,
  })

  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SerpApi request failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
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
  }

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`)
  }

  const places = data.local_results?.places ?? []

  const localDataByDomain = new Map<
    string,
    { rating: number; reviews: number; address?: string }
  >()
  const mapPackByDomainId = new Map<string, number>()
  for (const place of places) {
    const pos = place.position ?? 0
    if (!pos) continue
    const domainId = matchPlaceToDomainId(place, domains)
    if (domainId) mapPackByDomainId.set(domainId, pos)
    const website = place.links?.website
    if (website && place.rating != null) {
      const hostNorm = normalizeDomain(website)
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

  return { ranks, snapshot }
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
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY is not set')
  }

  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location,
    num: String(SERP_NUM_RESULTS),
    gl: 'us',
    hl: 'en',
    api_key: apiKey,
  })

  const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SerpApi request failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    organic_results?: Array<{ position?: number; link?: string }>
    error?: string
  }

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
