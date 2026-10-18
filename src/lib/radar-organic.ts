/** Comparable town-qualified organic searches. Never trust a location label alone. */
import type {
  OrganicAudit,
  OrganicObservation,
} from '@/lib/radar-organic-evidence'
import {
  normalizeDomain,
  TOWN_CENTROIDS,
  townKeyFromLocation,
  type RadarDomain,
  type SerpDomainWithPosition,
} from '@/lib/serpApi'
import { fetchSerpApiJson } from '@/lib/serpapi-budget'

type SearchPage = {
  search_metadata?: { id?: string; status?: string; google_url?: string }
  search_parameters?: { q?: string; location_used?: string }
  organic_results?: Array<{
    position?: number
    link?: string
    title?: string
    snippet?: string
  }>
  serpapi_pagination?: { next?: string }
  error?: string
}
export function townOrganicQuery(keyword: string, location: string): string {
  const town = location.split(',')[0].trim().toLowerCase()
  const term = keyword.trim().toLowerCase()
  return term.includes(town) ? term : `${term} ${town} co`
}
const normalizedText = (text: string) => {
  let decoded = text
  try {
    decoded = decodeURIComponent(text.replace(/\+/g, ' '))
  } catch {
    /* Titles can contain literal percent signs. */
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
}
export function isRelevantOrganicPage(
  page: SearchPage,
  query: string,
  location: string,
  firstPage = true,
): boolean {
  if (
    page.error ||
    page.search_metadata?.status !== 'Success' ||
    page.search_parameters?.q?.trim().toLowerCase() !== query.toLowerCase()
  )
    return false
  if (
    townKeyFromLocation(page.search_parameters?.location_used ?? '') !==
    townKeyFromLocation(location)
  )
    return false
  const rows = page.organic_results?.filter((row) => row.link) ?? []
  if (!rows.length) return false
  const town = normalizedText(location.split(',')[0])
  const terms = normalizedText(query)
    .split(town)[0]
    .trim()
    .split(' ')
    .map((word) => word.replace(/ing$/, ''))
  const texts = rows.map((row) =>
    normalizedText(`${row.title ?? ''} ${row.link ?? ''} ${row.snippet ?? ''}`),
  )
  // Detect the reproduced household-cleaning/wrong-city payloads despite a correct location label.
  return (
    texts.filter((text) => terms.every((term) => text.includes(term))).length >=
      Math.min(3, rows.length) &&
    (!firstPage ||
      texts.filter((text) => text.includes(town)).length >=
        Math.min(2, rows.length))
  )
}

export async function fetchAuditedOrganicRanks(
  keyword: string,
  location: string,
  domains: RadarDomain[],
  options: { deep?: boolean } = {},
) {
  const query = townOrganicQuery(keyword, location)
  const centroid = TOWN_CENTROIDS[townKeyFromLocation(location)]
  if (!centroid) throw new Error(`No centroid for ${location}`)
  const deep =
    options.deep ??
    new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'America/Denver',
    }).format(new Date()) === 'Sun'
  const errors: string[] = []
  const snapshot: SerpDomainWithPosition[] = []
  const pages: Array<{
    taskId?: string
    googleUrl?: string
    start: number
    returned: number
  }> = []
  const rejectedPages: unknown[] = []
  const urls = new Set<string>()
  let valid = false
  let exhausted = false
  for (let pageIndex = 0; pageIndex < (deep ? 5 : 1); pageIndex++) {
    try {
      const page = await fetchSerpApiJson<SearchPage>({
        source: pageIndex ? 'radar-organic-weekly-depth' : 'radar-organic-town',
        query,
        params: new URLSearchParams({
          engine: 'google',
          q: query,
          location: location.trim(),
          device: 'desktop',
          gl: 'us',
          hl: 'en',
          no_cache: 'true',
          start: String(pageIndex * 10),
        }),
        init: { cache: 'no-store', signal: AbortSignal.timeout(35_000) },
      })
      if (!isRelevantOrganicPage(page, query, location, pageIndex === 0)) {
        rejectedPages.push({
          taskId: page.search_metadata?.id,
          googleUrl: page.search_metadata?.google_url,
          start: pageIndex * 10,
          rows: page.organic_results?.map((row) => ({
            url: row.link,
            title: row.title,
          })),
        })
        throw new Error('Search returned unrelated or mismatched results')
      }
      let added = 0
      for (const row of page.organic_results ?? []) {
        if (
          !row.link ||
          urls.has(row.link) ||
          !Number.isInteger(row.position) ||
          (row.position ?? 0) < 1
        )
          continue
        const domain = normalizeDomain(row.link)
        if (!domain) continue
        urls.add(row.link)
        snapshot.push({
          domain,
          position:
            (row.position ?? 0) > 10
              ? row.position!
              : pageIndex * 10 + (row.position ?? 0),
          url: row.link,
          title: row.title ?? null,
        })
        added++
      }
      if (!added) throw new Error('Search repeated an earlier page')
      valid = true
      pages.push({
        taskId: page.search_metadata?.id,
        googleUrl: page.search_metadata?.google_url,
        start: pageIndex * 10,
        returned: added,
      })
      exhausted = !page.serpapi_pagination?.next
      const mine = domains.filter(
        (domain) => normalizeDomain(domain.domain) === 'sasquatchcarpet.com',
      )
      if (
        mine.some((domain) =>
          snapshot.some((row) => row.domain === normalizeDomain(domain.domain)),
        ) ||
        exhausted
      )
        break
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Search unavailable')
      break
    }
  }
  const checkedDepth = Math.max(0, ...snapshot.map((row) => row.position))
  const observations: Record<string, OrganicObservation> = {}
  const ranks = domains.map((domain) => {
    const row = snapshot.find(
      (row) => row.domain === normalizeDomain(domain.domain),
    )
    const rank = row?.position ?? null
    observations[domain.id] = {
      status: rank != null ? 'checked' : valid ? 'not_seen' : 'unverified',
      source: valid ? 'serpapi' : null,
      rank,
      depth: checkedDepth,
    }
    return { domain_id: domain.id, rank_position: rank }
  })
  const audit: OrganicAudit = {
    version: 2,
    method: 'town-qualified-v2',
    query,
    keyword,
    location,
    device: 'desktop',
    checkedAt: new Date().toISOString(),
    observations,
    primary: { rejectedPages },
    verification: valid
      ? {
          returnedDepth: checkedDepth,
          snapshot,
          pages,
          exhausted,
          deepRequested: deep,
        }
      : null,
    errors,
  }
  return {
    ranks,
    snapshot,
    requestedDepth: deep ? 50 : 10,
    returnedDepth: checkedDepth,
    taskId: pages[0]?.taskId ?? null,
    cost: 0,
    device: 'desktop' as const,
    lat: centroid.lat,
    lng: centroid.lng,
    audit,
  }
}
