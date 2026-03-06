/**
 * SerpApi Google Search integration for Radar (competitor SERP tracking).
 * Fetches top N organic results (num=20 to save credits); domains not in top N get rank N.
 * Uses gl/hl for US English. We do not pass no_cache so SerpApi can serve cached results.
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

const SERP_NUM_RESULTS = 20
const NOT_FOUND_RANK = SERP_NUM_RESULTS

/**
 * Fetch Google search results from SerpApi and return ranks for tracked domains.
 * Uses num=20 for faster responses and fewer credits; gl/hl for US English.
 */
export async function fetchSerpRanks(
  keyword: string,
  location: string,
  domains: RadarDomain[],
): Promise<SerpApiRankResult[]> {
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
  const domainMap = new Map<string, string>()
  for (const d of domains) {
    const norm = d.domain.toLowerCase().replace(/^www\./, '')
    domainMap.set(norm, d.id)
  }

  const results: SerpApiRankResult[] = []
  const found = new Set<string>()

  for (const item of organic) {
    const link = item.link
    const pos = item.position ?? 0
    if (!link || !pos) continue

    const hostNorm = normalizeDomain(link)
    if (!hostNorm) continue

    const domainId = domainMap.get(hostNorm)
    if (domainId && !found.has(domainId)) {
      found.add(domainId)
      results.push({ domain_id: domainId, rank_position: pos })
    }
  }

  // Domains not found in top N get rank N
  for (const d of domains) {
    if (!found.has(d.id)) {
      results.push({ domain_id: d.id, rank_position: NOT_FOUND_RANK })
    }
  }

  return results
}

/**
 * Fetch organic results for a keyword and return unique domains (for "Discover competitors").
 * Uses num=20, gl/hl for US English. Does not pass no_cache so SerpApi can use cache.
 */
export async function fetchSerpDomains(
  keyword: string,
  location: string,
): Promise<string[]> {
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
    organic_results?: Array<{ link?: string }>
    error?: string
  }

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`)
  }

  const organic = data.organic_results ?? []
  const seen = new Set<string>()
  const domains: string[] = []

  for (const item of organic) {
    const link = item.link
    if (!link) continue
    const hostNorm = normalizeDomain(link)
    if (!hostNorm || seen.has(hostNorm)) continue
    seen.add(hostNorm)
    domains.push(hostNorm)
  }

  return domains
}
