/** Shared evidence labels; safe for browser and server consumers. */
export type OrganicObservation = {
  status: 'checked' | 'observed' | 'not_seen' | 'unverified'
  source: 'serpapi' | 'dataforseo' | null
  rank: number | null
  depth: number
}

export type OrganicAudit = {
  version: 1
  keyword: string
  location: string
  device: 'desktop'
  checkedAt: string
  observations: Record<string, OrganicObservation>
  primary: unknown
  verification: unknown
  errors: string[]
}

export function organicObservation(
  audit: OrganicAudit | null | undefined,
  domainId: string,
): OrganicObservation {
  return (
    audit?.observations?.[domainId] ?? {
      status: 'unverified',
      source: null,
      rank: null,
      depth: 0,
    }
  )
}

export function describeOrganicObservation(
  observation: OrganicObservation,
): string {
  const { status, rank, depth } = observation
  if (status === 'checked' && rank != null)
    return `#${rank} · independent desktop check`
  if (status === 'observed' && rank != null)
    return `#${rank} observed in deeper scan · not independently verified`
  if (status === 'not_seen')
    return `not seen in ${depth} checked · deeper rank unknown`
  return 'scan unverified · ranking unknown'
}
