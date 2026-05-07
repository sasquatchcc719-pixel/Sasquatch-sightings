import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  RangerApplicant,
  RangerConfidence,
  RangerEvidence,
  RangerResearchDepth,
} from './types'

type ResearchFinding = {
  evidence_type: string
  source_label: string | null
  source_url: string | null
  finding: string
  confidence: RangerConfidence
  category: string
  sentiment: RangerEvidence['sentiment']
  raw_snippet: string | null
  metadata?: Record<string, unknown>
}

type FirecrawlSearchResult = {
  title?: string
  url?: string
  link?: string
  markdown?: string
  description?: string
  snippet?: string
  content?: string
}

const PUBLIC_RECORDS_TERMS = [
  'arrest',
  'charges',
  'burglary',
  'court',
  'case',
  'criminal',
  'jail',
  'inmate',
  'sheriff',
  'police',
  'mugshot',
  'warrant',
  'probation',
  'offender',
]

const STRONG_PUBLIC_RECORDS_TERMS = [
  'arrest',
  'charges',
  'burglary',
  'criminal',
  'jail',
  'inmate',
  'sheriff',
  'police',
  'mugshot',
  'warrant',
  'probation',
  'offender',
]

const LOW_VALUE_PUBLIC_RECORD_HOSTS = [
  'facebook.com',
  'radaris.com',
  'spokeo.com',
  'mylife.com',
  'whitepages.com',
  'beenverified.com',
  'truthfinder.com',
  'intelius.com',
]

function applicantLabel(applicant: RangerApplicant) {
  return (
    applicant.full_name ||
    applicant.email ||
    applicant.phone ||
    'unknown applicant'
  )
}

function buildResearchQueries(
  applicant: RangerApplicant,
  depth: RangerResearchDepth,
) {
  const name = applicant.full_name?.trim()
  const area = applicant.city_area?.trim()
  const email = applicant.email?.trim()
  const phone = applicant.phone?.trim()
  const base = [name, area].filter(Boolean).join(' ')
  const queries = [
    base ? `"${name}" ${area || ''} carpet cleaning work history`.trim() : null,
    base
      ? `"${name}" ${area || ''} cleaning labor customer service`.trim()
      : null,
    email ? `"${email}"` : null,
    phone ? `"${phone}"` : null,
  ].filter((query): query is string => Boolean(query))

  return depth === 'deep' ? queries : queries.slice(0, 2)
}

function buildPublicRecordsQueries(applicant: RangerApplicant) {
  const name = applicant.full_name?.trim()
  const area = applicant.city_area?.trim() || 'Colorado Springs Colorado'
  if (!name) return []

  return [
    `"${name}" "${area}" arrest OR charges OR court`,
    `"${name}" "${area}" burglary`,
    `"${name}" Colorado court case criminal`,
    `"${name}" El Paso County sheriff inmate`,
    `"${name}" mugshot arrest Colorado`,
    `"${name}" site:coloradojudicial.gov`,
    `"${name}" site:epcsheriffsoffice.com`,
    `"${name}" site:cbi.colorado.gov offender`,
  ]
}

function classifyFinding(
  result: FirecrawlSearchResult,
): ResearchFinding | null {
  const text = [
    result.title,
    result.description,
    result.content,
    result.markdown,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800)

  const url = result.url || result.link
  if (!url || !text.trim()) return null

  const lower = text.toLowerCase()
  const concernWords = [
    'arrest',
    'assault',
    'theft',
    'scam',
    'fraud',
    'threat',
    'harassment',
    'stole',
    'violent',
  ]
  const positiveWords = [
    'cleaning',
    'carpet',
    'construction',
    'delivery',
    'labor',
    'customer service',
    'review',
    'business',
  ]
  const hasConcern = concernWords.some((word) => lower.includes(word))
  const hasPositive = positiveWords.some((word) => lower.includes(word))

  return {
    evidence_type: 'public_web_search',
    source_label: result.title || new URL(url).hostname,
    source_url: url,
    finding: hasConcern
      ? 'Public search result may contain a job-relevant reliability, judgment, honesty, or safety concern. Human review required before drawing conclusions.'
      : hasPositive
        ? 'Public search result may support relevant work history or customer-facing experience.'
        : 'Public search result found for applicant identity review.',
    confidence: 'low',
    category: hasConcern ? 'safety' : hasPositive ? 'experience' : 'identity',
    sentiment: hasConcern ? 'concern' : hasPositive ? 'positive' : 'neutral',
    raw_snippet: text.slice(0, 1000),
    metadata: { classifier: 'keyword_triage' },
  }
}

async function searchWithFirecrawl(
  query: string,
): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return []

  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit: 5,
      scrapeOptions: { formats: ['markdown'] },
    }),
  })

  if (!response.ok) {
    throw new Error(`Firecrawl search failed: ${response.status}`)
  }

  const result = (await response.json()) as {
    data?: FirecrawlSearchResult[]
  }
  return result.data || []
}

async function searchWithSerpApi(
  query: string,
): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY
  if (!apiKey) return []

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', query)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('num', '5')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`SerpAPI search failed: ${response.status}`)
  }

  const result = (await response.json()) as {
    organic_results?: Array<{
      title?: string
      link?: string
      snippet?: string
    }>
  }

  return (result.organic_results || []).map((item) => ({
    title: item.title,
    url: item.link,
    description: item.snippet,
    content: item.snippet,
  }))
}

async function searchPublicWeb(
  query: string,
): Promise<FirecrawlSearchResult[]> {
  return process.env.FIRECRAWL_API_KEY
    ? searchWithFirecrawl(query)
    : searchWithSerpApi(query)
}

function identityConfidenceForPublicRecord(
  applicant: RangerApplicant,
  result: FirecrawlSearchResult,
) {
  const text = [
    result.title,
    result.description,
    result.snippet,
    result.content,
    result.markdown,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const name = applicant.full_name?.toLowerCase()
  const area = applicant.city_area?.toLowerCase()
  const hasName = Boolean(name && text.includes(name))
  const hasArea = Boolean(area && text.includes(area))
  const textDigits = text.replace(/\D/g, '')
  const hasPhone = Boolean(
    applicant.phone && textDigits.includes(applicant.phone.replace(/\D/g, '')),
  )
  const hasEmail = Boolean(
    applicant.email && text.includes(applicant.email.toLowerCase()),
  )

  if (hasName && (hasPhone || hasEmail)) return 'high'
  if (hasName && hasArea) return 'medium'
  if (hasName) return 'low'
  return 'low'
}

function classifyPublicRecordFinding(
  applicant: RangerApplicant,
  result: FirecrawlSearchResult,
): ResearchFinding | null {
  const url = result.url || result.link
  const text = [
    result.title,
    result.description,
    result.snippet,
    result.content,
    result.markdown,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800)

  if (!url || !text.trim()) return null

  const lower = text.toLowerCase()
  const exactName = applicant.full_name?.trim().toLowerCase()
  if (!exactName || !lower.includes(exactName)) return null

  const sourceHost = new URL(url).hostname.replace(/^www\./, '')
  if (LOW_VALUE_PUBLIC_RECORD_HOSTS.some((host) => sourceHost.endsWith(host))) {
    return null
  }

  const hasPublicRecordTerm = PUBLIC_RECORDS_TERMS.some((term) =>
    lower.includes(term),
  )
  if (!hasPublicRecordTerm) return null
  const hasStrongPublicRecordTerm = STRONG_PUBLIC_RECORDS_TERMS.some((term) =>
    lower.includes(term),
  )
  if (!hasStrongPublicRecordTerm) return null

  const officialSource =
    sourceHost.endsWith('.gov') ||
    sourceHost.includes('sheriff') ||
    sourceHost.includes('police') ||
    sourceHost.includes('coloradojudicial')
  const identityConfidence = identityConfidenceForPublicRecord(
    applicant,
    result,
  )
  if (
    !officialSource &&
    identityConfidence === 'low' &&
    !lower.includes('colorado springs')
  ) {
    return null
  }
  const snippet = text.slice(0, 420).replace(/\s+/g, ' ').trim()

  return {
    evidence_type: 'public_records_search',
    source_label: result.title || sourceHost,
    source_url: url,
    finding: `Possible public-records lead from ${result.title || sourceHost}: ${snippet}`,
    confidence:
      officialSource && identityConfidence !== 'low' ? 'medium' : 'low',
    category: 'safety',
    sentiment: 'concern',
    raw_snippet: text.slice(0, 1000),
    metadata: {
      classifier: 'public_records_keyword_triage',
      identity_confidence: identityConfidence,
      official_source: officialSource,
      public_record_terms: PUBLIC_RECORDS_TERMS.filter((term) =>
        lower.includes(term),
      ),
    },
  }
}

async function insertFindings(params: {
  supabase: SupabaseClient
  applicantId: string
  findings: ResearchFinding[]
}) {
  const { supabase, applicantId, findings } = params
  if (findings.length === 0) return 0

  const { error } = await supabase.from('ranger_evidence').insert(
    findings.map((finding) => ({
      applicant_id: applicantId,
      evidence_type: finding.evidence_type,
      source_label: finding.source_label,
      source_url: finding.source_url,
      finding: finding.finding,
      confidence: finding.confidence === 'unknown' ? 'low' : finding.confidence,
      category: finding.category,
      sentiment: finding.sentiment,
      raw_snippet: finding.raw_snippet,
      metadata: finding.metadata || {},
    })),
  )

  if (error) throw error
  return findings.length
}

export async function runRangerPublicResearch(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
  depth: RangerResearchDepth
}) {
  const { supabase, applicant, depth } = params
  const queries = buildResearchQueries(applicant, depth)
  const findings: ResearchFinding[] = []

  if (queries.length === 0) {
    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: 'ranger',
      event_type: 'research_skipped',
      event_summary: `Ranger skipped public research for ${applicantLabel(applicant)} because identifying information is missing.`,
      payload: { depth },
    })
    return { queries, findingsInserted: 0, skipped: true }
  }

  if (!process.env.FIRECRAWL_API_KEY && !process.env.SERPAPI_API_KEY) {
    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: 'ranger',
      event_type: 'research_waiting_for_tool',
      event_summary:
        'Ranger queued research, but no public search API key is configured in this environment.',
      payload: { depth, queries },
    })
    return { queries, findingsInserted: 0, skipped: true }
  }

  for (const query of queries) {
    const results = await searchPublicWeb(query)
    findings.push(
      ...results
        .map((result) => classifyFinding(result))
        .filter((finding): finding is ResearchFinding => Boolean(finding)),
    )
  }

  const uniqueFindings = findings.filter((finding, index, list) => {
    return (
      finding.source_url &&
      list.findIndex((item) => item.source_url === finding.source_url) === index
    )
  })
  const findingsInserted = await insertFindings({
    supabase,
    applicantId: applicant.id,
    findings: uniqueFindings,
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor: 'ranger',
    event_type: 'public_research_completed',
    event_summary: `Ranger completed ${depth} public research for ${applicantLabel(applicant)}.`,
    payload: { depth, queries, findingsInserted },
  })

  return { queries, findingsInserted, skipped: false }
}

export async function runRangerPublicRecordsCheck(params: {
  supabase: SupabaseClient
  applicant: RangerApplicant
}) {
  const { supabase, applicant } = params
  const queries = buildPublicRecordsQueries(applicant)
  const findings: ResearchFinding[] = []

  if (queries.length === 0) {
    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: 'ranger',
      event_type: 'public_records_skipped',
      event_summary:
        'Ranger skipped public-records check because applicant name is missing.',
      payload: {},
    })
    return { queries, findingsInserted: 0, skipped: true }
  }

  if (!process.env.FIRECRAWL_API_KEY && !process.env.SERPAPI_API_KEY) {
    await supabase.from('ranger_audit_events').insert({
      applicant_id: applicant.id,
      actor: 'ranger',
      event_type: 'public_records_waiting_for_tool',
      event_summary:
        'Ranger queued public-records check, but no public search API key is configured.',
      payload: { queries },
    })
    return { queries, findingsInserted: 0, skipped: true }
  }

  for (const query of queries) {
    const results = await searchPublicWeb(query)
    findings.push(
      ...results
        .map((result) => classifyPublicRecordFinding(applicant, result))
        .filter((finding): finding is ResearchFinding => Boolean(finding)),
    )
  }

  const uniqueFindings = findings.filter((finding, index, list) => {
    return (
      finding.source_url &&
      list.findIndex((item) => item.source_url === finding.source_url) === index
    )
  })
  const findingsInserted = await insertFindings({
    supabase,
    applicantId: applicant.id,
    findings: uniqueFindings,
  })

  await supabase.from('ranger_audit_events').insert({
    applicant_id: applicant.id,
    actor: 'ranger',
    event_type: 'public_records_completed',
    event_summary: `Ranger completed public-records check for ${applicantLabel(applicant)}.`,
    payload: { queries, findingsInserted },
  })

  return { queries, findingsInserted, skipped: false }
}
