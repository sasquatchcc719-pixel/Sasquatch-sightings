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

  const ranks: SerpApiRankResult[] = []
  const found = new Set<string>()
  const snapshot: SerpDomainWithPosition[] = []

  for (const item of organic) {
    const link = item.link
    const pos = item.position ?? 0
    if (!link || !pos) continue

    const hostNorm = normalizeDomain(link)
    if (!hostNorm) continue

    snapshot.push({ domain: hostNorm, position: pos })

    const domainId = domainMap.get(hostNorm)
    if (domainId && !found.has(domainId)) {
      found.add(domainId)
      ranks.push({ domain_id: domainId, rank_position: pos })
    }
  }

  for (const d of domains) {
    if (!found.has(d.id)) {
      ranks.push({ domain_id: d.id, rank_position: NOT_FOUND_RANK })
    }
  }

  return { ranks, snapshot }
}

export type SerpDomainWithPosition = { domain: string; position: number }

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
