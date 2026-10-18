/** Organic evidence from two providers. A shallow miss never means rank 51. */
import type {
  OrganicAudit,
  OrganicObservation,
} from '@/lib/radar-organic-evidence'
import { fetchOrganicRanks } from '@/lib/dataforseo'
import {
  normalizeDomain,
  TOWN_CENTROIDS,
  townKeyFromLocation,
  type RadarDomain,
  type SerpDomainWithPosition,
} from '@/lib/serpApi'
import { fetchSerpApiJson } from '@/lib/serpapi-budget'

type VerificationResult = {
  search_metadata?: { id?: string; status?: string; google_url?: string }
  search_parameters?: { location_used?: string; location_requested?: string }
  organic_results?: Array<{ position?: number; link?: string; title?: string }>
  error?: string
}

export async function fetchAuditedOrganicRanks(
  keyword: string,
  location: string,
  domains: RadarDomain[],
) {
  const errors: string[] = []
  const [primaryResult, verificationResult] = await Promise.allSettled([
    fetchOrganicRanks(keyword, location, domains),
    fetchSerpApiJson<VerificationResult>({
      source: 'radar-organic-verification',
      query: `${keyword} | ${location}`,
      params: new URLSearchParams({
        engine: 'google',
        q: keyword.trim(),
        location: location.trim(),
        device: 'desktop',
        gl: 'us',
        hl: 'en',
        no_cache: 'true',
      }),
      init: { cache: 'no-store', signal: AbortSignal.timeout(45_000) },
    }),
  ])
  const primary =
    primaryResult.status === 'fulfilled' ? primaryResult.value : null
  if (primaryResult.status === 'rejected')
    errors.push(
      `Deeper scan: ${primaryResult.reason instanceof Error ? primaryResult.reason.message : 'unavailable'}`,
    )
  let verification =
    verificationResult.status === 'fulfilled' ? verificationResult.value : null
  if (verificationResult.status === 'rejected')
    errors.push(
      'Independent check unavailable (provider, timeout, or monthly quota)',
    )
  if (verification) {
    const used = verification.search_parameters?.location_used
    const requestedTown = townKeyFromLocation(location)
    if (
      verification.error ||
      verification.search_metadata?.status !== 'Success' ||
      !used ||
      townKeyFromLocation(used) !== requestedTown ||
      !verification.organic_results?.some(
        (row) => row.link && (row.position ?? 0) > 0,
      )
    ) {
      errors.push(
        'Independent check returned empty, unsuccessful, or mismatched-location results',
      )
      verification = null
    }
  }
  const verifiedSnapshot: SerpDomainWithPosition[] = (
    verification?.organic_results ?? []
  ).flatMap((item) => {
    const domain = item.link ? normalizeDomain(item.link) : null
    return domain && (item.position ?? 0) > 0
      ? [
          {
            domain,
            position: item.position!,
            url: item.link!,
            title: item.title ?? null,
          },
        ]
      : []
  })
  const verifiedDepth = Math.max(
    0,
    ...verifiedSnapshot.map((row) => row.position),
  )
  const observations: Record<string, OrganicObservation> = {}
  const ranks = domains.map((domain) => {
    const normalized = normalizeDomain(domain.domain)
    const independentRank =
      verifiedSnapshot.find((row) => row.domain === normalized)?.position ??
      null
    const deeperRank =
      primary?.ranks.find((row) => row.domain_id === domain.id)
        ?.rank_position ?? null
    // Preserve a deeper positive observation; a first-page miss cannot refute it.
    const rank = independentRank ?? deeperRank
    observations[domain.id] = {
      status:
        independentRank != null
          ? 'checked'
          : deeperRank != null
            ? 'observed'
            : verification
              ? 'not_seen'
              : 'unverified',
      source:
        independentRank != null
          ? 'serpapi'
          : deeperRank != null
            ? 'dataforseo'
            : verification
              ? 'serpapi'
              : null,
      rank,
      depth:
        independentRank != null || deeperRank == null
          ? verifiedDepth
          : (primary?.returnedDepth ?? 0),
    }
    return { domain_id: domain.id, rank_position: rank }
  })
  const centroid = TOWN_CENTROIDS[townKeyFromLocation(location)]
  if (!centroid) throw new Error(`No centroid for ${location}`)
  const audit: OrganicAudit = {
    version: 1,
    keyword,
    location,
    device: 'desktop',
    checkedAt: new Date().toISOString(),
    observations,
    primary: primary
      ? {
          taskId: primary.taskId,
          requestedDepth: primary.requestedDepth,
          returnedDepth: primary.returnedDepth,
          snapshot: primary.snapshot,
        }
      : null,
    verification: verification
      ? {
          taskId: verification.search_metadata?.id,
          googleUrl: verification.search_metadata?.google_url,
          locationUsed: verification.search_parameters?.location_used,
          returnedDepth: verifiedDepth,
          snapshot: verifiedSnapshot,
        }
      : null,
    errors,
  }
  return {
    ranks,
    // The legacy snapshot table remains one coherent result set. Both full
    // result sets and per-domain provenance are preserved in organic_audit.
    snapshot: verification ? verifiedSnapshot : (primary?.snapshot ?? []),
    requestedDepth: primary?.requestedDepth ?? 10,
    returnedDepth: primary?.returnedDepth ?? verifiedDepth,
    taskId: primary?.taskId ?? verification?.search_metadata?.id ?? null,
    cost: primary?.cost ?? 0,
    device: 'desktop' as const,
    lat: centroid.lat,
    lng: centroid.lng,
    audit,
  }
}
