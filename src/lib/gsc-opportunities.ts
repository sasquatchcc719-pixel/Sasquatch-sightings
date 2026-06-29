/**
 * Monthly GSC "page-2 opportunity" report.
 *
 * Pulls per-keyword/per-page search analytics, isolates keywords sitting just
 * off page 1 (positions ~8-20) with enough real search volume to matter, reads
 * the live content of each ranking page, and asks OpenAI what content gaps to
 * fill to push the page onto page 1. Delivers a Telegram digest to Charles as a
 * monthly reminder to review + a concrete edit list.
 *
 * This NEVER edits the live site — it only recommends. Charles applies the
 * good suggestions by hand.
 */

import OpenAI from 'openai'
import {
  getSearchConsoleClient,
  queryKeywordRows,
  GSC_WWW_PROPERTY,
  type GscKeywordRow,
} from '@/lib/gsc'
import { sendTelegramNotification } from '@/lib/telegram'

/** Window of search data to analyze (days). 28d ≈ one month of signal. */
const WINDOW_DAYS = 28
/** GSC data lags ~2 days; never ask for the freshest 2 days. */
const DATA_LAG_DAYS = 2
/** Position band that counts as a "close" opportunity. */
const MIN_POSITION = 8
const MAX_POSITION = 20.5
/** Floor on monthly impressions — kills one-off / wrong-geo noise. */
const MIN_IMPRESSIONS = 5
/** How many opportunities to analyze + report. */
const MAX_OPPORTUNITIES = 6
/** Max characters of live page text fed to the model per page. */
const PAGE_TEXT_LIMIT = 4000
/** Best model that reliably finishes inside the serverless cron window. */
const MODEL = process.env.GSC_OPPORTUNITY_MODEL || 'gpt-5.5'

export type Opportunity = GscKeywordRow & {
  /** Recommendation text from the model (gap → what to add). */
  recommendation?: string
}

export type GscOpportunityResult = {
  analyzed: number
  opportunities: Opportunity[]
  digest: string
}

function shortPath(url: string): string {
  return (
    url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '') || '/'
  )
}

/**
 * Select the keywords worth acting on: in the position band, above the
 * impressions floor, de-duplicated to the single best (highest-impression)
 * keyword per page so we don't recommend the same page twice. Sorted by
 * impressions desc.
 */
export function selectOpportunities(rows: GscKeywordRow[]): GscKeywordRow[] {
  const candidates = rows
    .filter(
      (r) =>
        r.position >= MIN_POSITION &&
        r.position <= MAX_POSITION &&
        r.impressions >= MIN_IMPRESSIONS,
    )
    .sort((a, b) => b.impressions - a.impressions)

  const bestPerPage = new Map<string, GscKeywordRow>()
  for (const r of candidates) {
    if (!bestPerPage.has(r.page)) bestPerPage.set(r.page, r)
  }
  return [...bestPerPage.values()]
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, MAX_OPPORTUNITIES)
}

/** Fetch a live page and reduce it to readable text for the model. */
async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      next: { revalidate: 0 },
      headers: { 'user-agent': 'SasquatchSEOBot/1.0' },
    })
    if (!res.ok) return ''
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, PAGE_TEXT_LIMIT)
  } catch {
    return ''
  }
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start)
    return trimmed.slice(start, end + 1)
  return trimmed
}

/**
 * One batched OpenAI call: given each opportunity + the current page text,
 * return a specific content-gap recommendation per keyword.
 */
async function recommendGaps(
  items: Array<{
    keyword: string
    page: string
    position: number
    text: string
  }>,
): Promise<Record<string, string>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const blocks = items
    .map(
      (it, i) =>
        `[${i + 1}] KEYWORD: "${it.keyword}" (currently ranking ~position ${it.position.toFixed(0)})
PAGE: ${it.page}
CURRENT PAGE CONTENT:
${it.text || '(could not read page content)'}`,
    )
    .join('\n\n---\n\n')

  const prompt = `You are an SEO content strategist for Sasquatch Carpet Cleaning, a PREMIUM carpet/upholstery/tile-&-grout cleaning company serving Monument, Palmer Lake, Castle Rock, Colorado Springs, Black Forest, Woodmoor, Gleneagle, and Larkspur, Colorado. Sasquatch competes on QUALITY and expertise, NOT on price.

Each item below is a keyword where our page is stuck on page 2 of Google (positions 8-20). For each one, look at what the page ACTUALLY says and recommend a specific WORDING / CONTENT change that would better match the keyword's intent and push the page onto page 1.

Recommend content gaps around things like:
- The service explained in depth (process, method, what makes the result better, what surfaces/fabrics/situations are handled)
- Proof and trust (before/after results, reviews, guarantees, owner-on-site, equipment)
- Local relevance (genuine specifics about the city/area, the kinds of homes or jobs there)
- Better headings, intro wording, and on-page phrasing that naturally include the keyword's intent

HARD RULES — follow exactly:
- NEVER mention price, pricing, cost, rates, "$", "starting at", price tables, or anything about money. Price is irrelevant to these recommendations. Do not recommend adding, removing, or changing any pricing content under any circumstances.
- Be specific and actionable. "Add a tile & grout section describing your process and 2 before/after photos" — NOT "improve content".
- Do not invent facts, phone numbers, or claims.
- If the keyword is a bargain/price-shopper search (e.g. contains "cheap", "cost", "price", "affordable") or its intent does not match the page (wrong service or wrong city), recommend SKIPPING it and briefly say why — do not force a change.
- Keep each recommendation to 1-2 sentences.

Items:
${blocks}

Respond with ONLY a JSON object mapping the item number (as a string) to its recommendation string, e.g. {"1": "...", "2": "..."}.`

  const openai = new OpenAI({ apiKey })
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
  })
  const raw = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!raw) throw new Error('OpenAI returned empty response')

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>
  } catch {
    throw new Error(
      `Opportunity AI did not return valid JSON: ${raw.slice(0, 200)}`,
    )
  }

  const out: Record<string, string> = {}
  items.forEach((it, i) => {
    const v = parsed[String(i + 1)]
    if (typeof v === 'string' && v.trim()) out[it.keyword] = v.trim()
  })
  return out
}

// Plain text (no Telegram Markdown): AI output can contain stray * or _ that
// would make Telegram reject the whole message. The weekly GSC watch sends
// plain for the same reason — reliability over bold text.
function buildDigest(opps: Opportunity[]): string {
  if (opps.length === 0) {
    return (
      `🔍 Monthly SEO Opportunities (last ${WINDOW_DAYS}d)\n\n` +
      `No page-2 keywords cleared the volume threshold this month. Nothing to action — traffic is still building.`
    )
  }
  const lines = [
    `🔍 Monthly SEO Opportunities (last ${WINDOW_DAYS}d)`,
    `Keywords you're close on (page 2 / edge of page 1). Edit these pages to break onto page 1:`,
    '',
  ]
  opps.forEach((o, i) => {
    lines.push(
      `${i + 1}. "${o.keyword}" — pos ${o.position.toFixed(1)} · ${o.impressions} searches · ${o.clicks} clicks`,
    )
    lines.push(`📄 ${shortPath(o.page)}`)
    if (o.recommendation) lines.push(`💡 ${o.recommendation}`)
    lines.push('')
  })
  lines.push(`Suggestions only — review and apply the ones worth your time.`)
  return lines.join('\n')
}

export async function runGscOpportunities(
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
    /** Skip the Telegram send (used by integration runs / previews). */
    skipNotify?: boolean
  } = {},
): Promise<GscOpportunityResult> {
  const notifyOwner =
    options.notifyOwner ??
    ((text: string) => sendTelegramNotification(text, { disablePreview: true }))

  const sc = getSearchConsoleClient()
  const rows = await queryKeywordRows(
    sc,
    GSC_WWW_PROPERTY,
    WINDOW_DAYS + DATA_LAG_DAYS,
    DATA_LAG_DAYS,
  )
  const selected = selectOpportunities(rows)

  // Read each page once (opportunities are already de-duped per page).
  const withText = await Promise.all(
    selected.map(async (o) => ({ ...o, text: await fetchPageText(o.page) })),
  )

  let recs: Record<string, string> = {}
  if (withText.length > 0) {
    try {
      recs = await recommendGaps(
        withText.map((o) => ({
          keyword: o.keyword,
          page: shortPath(o.page),
          position: o.position,
          text: o.text,
        })),
      )
    } catch (err) {
      // Don't lose the whole report if the model call fails — ship the ranked
      // keyword list without recommendations and log the failure.
      console.error('[gsc-opportunities] AI recommendation failed:', err)
    }
  }

  const opportunities: Opportunity[] = selected.map((o) => ({
    ...o,
    recommendation: recs[o.keyword],
  }))
  const digest = buildDigest(opportunities)

  if (!options.skipNotify) {
    await notifyOwner(digest).catch((err) =>
      console.error('[gsc-opportunities] owner notify failed:', err),
    )
  }

  return { analyzed: selected.length, opportunities, digest }
}
