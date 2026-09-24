/**
 * Thursday Google index check.
 *
 * Inspects up to 250 unique sitemap URLs, stores the results for trend
 * reporting, and sends Charles a plain-language Telegram summary. This monitor
 * is deliberately read-only: it never asks Google to crawl or index a URL.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSearchConsoleClient,
  inspectUrl,
  fetchSitemapUrls,
  GSC_WWW_PROPERTY,
  GSC_SIGHTINGS_PROPERTY,
  type GscInspection,
} from '@/lib/gsc'
import { sendTelegramNotification } from '@/lib/telegram'

/** Sitemaps in priority order — marketing money pages first, jobs last. */
const SITEMAPS = [
  'https://www.sasquatchcarpet.com/sitemap.xml',
  'https://www.sasquatchcarpet.com/sitemap-jobs.xml',
  'https://sightings.sasquatchcarpet.com/sitemap.xml',
]
const MAX_INSPECTIONS = 250
const INSPECT_CONCURRENCY = 8
const INDEXED_STATES = new Set([
  'Submitted and indexed',
  'Indexed, not submitted in sitemap',
])

export type CoverageBucket = 'indexed' | 'waiting' | 'other'

export type IndexCheckResult = {
  inspected: number
  indexed: number
  waiting: number
  other: number
  unavailable: number
  newlyIndexed: string[]
  droppedFromIndex: string[]
  digest: string
}

function shortPath(url: string): string {
  return (
    url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '') || '/'
  )
}

/** Which GSC property a URL belongs to (inspection requires the right one). */
export function propertyForUrl(url: string): string {
  return url.includes('//sightings.sasquatchcarpet.com')
    ? GSC_SIGHTINGS_PROPERTY
    : GSC_WWW_PROPERTY
}

export function coverageBucket(coverage: string | null): CoverageBucket {
  if (INDEXED_STATES.has(coverage || '')) return 'indexed'
  if (/not indexed/i.test(coverage || '')) return 'waiting'
  return 'other'
}

async function collectTargets(): Promise<string[]> {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const sm of SITEMAPS) {
    let urls: string[] = []
    try {
      urls = await fetchSitemapUrls(sm)
    } catch {
      /* a failed sitemap fetch just narrows coverage this run */
    }
    for (const url of urls) {
      if (url.endsWith('llms.txt')) continue
      if (!seen.has(url)) {
        seen.add(url)
        ordered.push(url)
      }
    }
  }
  return ordered.slice(0, MAX_INSPECTIONS)
}

async function previousCoverage(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('gsc_page_snapshots')
    .select('url, coverage, checked_at')
    .order('checked_at', { ascending: false })
    .limit(2000)

  if (error) {
    console.error('[index-check] previous snapshot load failed:', error)
    return new Map()
  }

  const latestByUrl = new Map<string, string>()
  for (const row of data || []) {
    if (!latestByUrl.has(row.url)) {
      latestByUrl.set(row.url, row.coverage || '')
    }
  }
  return latestByUrl
}

export async function runGscIndexCheck(
  supabase: SupabaseClient,
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
    skipNotify?: boolean
    /** Override target URLs (tests and diagnostics pass a tiny list). */
    targets?: string[]
    /** Inspect without storing results. */
    dryRun?: boolean
  } = {},
): Promise<IndexCheckResult> {
  const notifyOwner =
    options.notifyOwner ??
    ((text: string) => sendTelegramNotification(text, { disablePreview: true }))

  const prior = await previousCoverage(supabase)
  const sc = getSearchConsoleClient()
  const targets = options.targets ?? (await collectTargets())

  const results: GscInspection[] = []
  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const url = targets[cursor++]
      try {
        results.push(await inspectUrl(sc, propertyForUrl(url), url))
      } catch (err) {
        console.error(`[index-check] inspect failed for ${url}:`, err)
      }
    }
  }
  await Promise.all(Array.from({ length: INSPECT_CONCURRENCY }, worker))

  const indexed = results.filter(
    (r) => coverageBucket(r.coverage) === 'indexed',
  )
  const waiting = results.filter(
    (r) => coverageBucket(r.coverage) === 'waiting',
  )
  const other = results.filter((r) => coverageBucket(r.coverage) === 'other')
  const unavailable = targets.length - results.length

  const newlyIndexed: string[] = []
  const droppedFromIndex: string[] = []
  for (const result of results) {
    const oldCoverage = prior.get(result.url)
    if (oldCoverage === undefined) continue
    const wasIndexed = coverageBucket(oldCoverage) === 'indexed'
    const isIndexed = coverageBucket(result.coverage) === 'indexed'
    if (!wasIndexed && isIndexed) newlyIndexed.push(shortPath(result.url))
    if (wasIndexed && !isIndexed) droppedFromIndex.push(shortPath(result.url))
  }

  if (!options.dryRun && results.length > 0) {
    const { error } = await supabase.from('gsc_page_snapshots').insert(
      results.map((result) => ({
        property: result.property,
        url: result.url,
        coverage: result.coverage,
        verdict: result.verdict,
        last_crawl_at: result.lastCrawlAt,
      })),
    )
    if (error) console.error('[index-check] snapshot insert failed:', error)
  }

  const changeLine =
    newlyIndexed.length || droppedFromIndex.length
      ? `Since the last check: ${newlyIndexed.length} newly indexed${
          droppedFromIndex.length
            ? ` · ${droppedFromIndex.length} no longer indexed`
            : ''
        }`
      : prior.size
        ? 'Since the last check: no indexing changes'
        : null

  const lines = [
    '🔎 Thursday Google Index Check',
    '',
    `${indexed.length} of ${results.length} checked pages can appear in Google Search.`,
    '',
    `✅ Indexed: ${indexed.length}`,
    `⏳ Waiting on Google: ${waiting.length}`,
    `ℹ️ Unknown or excluded: ${other.length}`,
    unavailable ? `⚠️ Could not check: ${unavailable}` : null,
    '',
    changeLine,
    'Monitoring only — no recrawl requests were sent.',
  ].filter((line): line is string => line !== null)
  const digest = lines.join('\n')

  if (!options.skipNotify) {
    await notifyOwner(digest).catch((err) =>
      console.error('[index-check] owner notify failed:', err),
    )
  }

  return {
    inspected: results.length,
    indexed: indexed.length,
    waiting: waiting.length,
    other: other.length,
    unavailable,
    newlyIndexed,
    droppedFromIndex,
    digest,
  }
}
