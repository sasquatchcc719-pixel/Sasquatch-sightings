/**
 * Deep-dive gatherer for competitor dossiers.
 * Fetches homepage text + SerpApi search snippets; optionally merge with Radar SERP summary.
 */

import { fetchSerpSnippets } from '@/lib/serpApi'

const FETCH_TIMEOUT_MS = 10_000
const HOMEPAGE_TEXT_CAP = 12_000

/**
 * Strip HTML tags and normalize whitespace. Simple regex-based for server-side.
 */
function stripHtml(html: string): string {
  const noScript = html.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    '',
  )
  const noStyle = noScript.replace(
    /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
    '',
  )
  const text = noStyle.replace(/<[^>]+>/g, ' ')
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '. ')
    .trim()
}

/**
 * Fetch a URL with timeout; return plain text from body (strip HTML, cap length).
 */
async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SasquatchRadar/1.0; +https://sasquatchcarpet.com)',
      },
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const html = await res.text()
    const text = stripHtml(html)
    return text.slice(0, HOMEPAGE_TEXT_CAP)
  } catch {
    clearTimeout(timeout)
    return ''
  }
}

export type GatheredContext = {
  homepageText: string
  searchSnippets: Array<{ title: string; snippet: string }>
  radarSummary: string
  combined: string
}

/**
 * Gather context for a competitor: homepage + web search snippets + optional Radar summary.
 * Returns a single combined string for the AI, and structured parts if needed.
 */
export async function gatherDossierContext(
  domain: string,
  displayName: string | null,
  radarSummary: string = '',
): Promise<GatheredContext> {
  const baseDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '')
  const homepageUrl = `https://${baseDomain}`

  const [homepageText, searchSnippets] = await Promise.all([
    fetchPageText(homepageUrl),
    fetchSerpSnippets(
      `"${displayName || baseDomain}" carpet cleaning`,
      'Colorado Springs, Colorado, United States',
    ).catch(() => [] as Array<{ title: string; snippet: string }>),
  ])

  const snippetBlock =
    searchSnippets.length > 0
      ? searchSnippets.map((s) => `- ${s.title}\n  ${s.snippet}`).join('\n')
      : '(No search snippets)'

  const combined = [
    '--- Competitor website (excerpt) ---',
    homepageText || '(Could not fetch website)',
    '',
    '--- Web search results (titles and snippets) ---',
    snippetBlock,
    '',
    '--- Our Radar SERP data for this domain ---',
    radarSummary || '(No ranking/snapshot data yet)',
  ].join('\n')

  return {
    homepageText: homepageText || '',
    searchSnippets,
    radarSummary,
    combined,
  }
}
