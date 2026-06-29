/**
 * GSC Index Sweep — force-crawl campaign for a large, crawl-budget-starved site.
 *
 * Sasquatch has far more pages (40+ marketing pages + hundreds of job/sightings
 * pages) than its authority earns in Google crawl budget, so deep pages sit at
 * "Discovered – currently not indexed" and never get crawled. This sweep:
 *   1. pulls every URL from our sitemaps (marketing first, then job pages)
 *   2. inspects each page's real index status (URL Inspection API)
 *   3. fires Indexing API pings at the pages that are NOT indexed, to force a
 *      crawl (capped under the daily quota; only un-indexed pages, never spam)
 *   4. sends Charles a Telegram progress report
 *
 * Re-runs keep nudging stuck pages and stop pinging once they index. The
 * Indexing API is officially for job-posting pages; for other pages it's an
 * effective crawl nudge, not a guarantee — pair with internal linking.
 */

import {
  getSearchConsoleClient,
  inspectUrl,
  fetchSitemapUrls,
  GSC_WWW_PROPERTY,
  GSC_SIGHTINGS_PROPERTY,
  type GscInspection,
} from '@/lib/gsc'
import { pingGoogleIndexing } from '@/lib/google-indexing'
import { sendTelegramNotification } from '@/lib/telegram'

/** Sitemaps in priority order — marketing money pages first, jobs last. */
const SITEMAPS = [
  'https://www.sasquatchcarpet.com/sitemap.xml',
  'https://www.sasquatchcarpet.com/sitemap-jobs.xml',
  'https://sightings.sasquatchcarpet.com/sitemap.xml',
]
/**
 * URL Inspection is slow (~6s/page observed) so the run cap is set by the 300s
 * cron window, not the API quota (2000/day, 600/min). At concurrency 8, ~100
 * inspections (~80s) + pings fits comfortably. Marketing pages sit first in the
 * sitemap order, so they're always covered; deeper job pages rotate across runs.
 */
const MAX_INSPECTIONS = 100
const INSPECT_CONCURRENCY = 8
/** Indexing API publish quota defaults to 200/day — stay under it. */
const MAX_PINGS = 90
/** Coverage states that count as "live in Google's index". */
const INDEXED_STATES = new Set([
  'Submitted and indexed',
  'Indexed, not submitted in sitemap',
])

export type IndexSweepResult = {
  inspected: number
  indexed: number
  notIndexed: number
  pinged: string[]
  pingFailed: number
  stillStuck: string[]
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

/**
 * A page is worth pinging when Google has it on file but hasn't indexed it —
 * the crawl-budget symptom ("Discovered/Crawled – currently not indexed").
 * We deliberately skip hard problems (blocked, redirect, noindex, 404): a ping
 * won't fix those, so pinging them just burns quota.
 */
export function isPingable(coverage: string | null): boolean {
  if (!coverage) return false
  if (INDEXED_STATES.has(coverage)) return false
  return /not indexed/i.test(coverage)
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
    for (const u of urls) {
      if (u.endsWith('llms.txt')) continue
      if (!seen.has(u)) {
        seen.add(u)
        ordered.push(u)
      }
    }
  }
  return ordered.slice(0, MAX_INSPECTIONS)
}

export async function runGscIndexSweep(
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
    skipNotify?: boolean
    /** Override target URLs (tests pass a tiny list). */
    targets?: string[]
    /** Disable the actual Indexing API calls (dry run). */
    dryRun?: boolean
  } = {},
): Promise<IndexSweepResult> {
  const notifyOwner =
    options.notifyOwner ??
    ((text: string) => sendTelegramNotification(text, { disablePreview: true }))

  const sc = getSearchConsoleClient()
  const targets = options.targets ?? (await collectTargets())

  // Inspect with modest concurrency (quota: 600/min, 2000/day per property).
  const results: GscInspection[] = []
  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const url = targets[cursor++]
      try {
        results.push(await inspectUrl(sc, propertyForUrl(url), url))
      } catch (err) {
        console.error(`[index-sweep] inspect failed for ${url}:`, err)
      }
    }
  }
  await Promise.all(Array.from({ length: INSPECT_CONCURRENCY }, worker))

  const indexed = results.filter((r) => INDEXED_STATES.has(r.coverage || ''))
  const pingable = results.filter((r) => isPingable(r.coverage))

  // Force-crawl the stuck pages (marketing-first ordering preserved), capped.
  const toPing = pingable.slice(0, MAX_PINGS)
  const pinged: string[] = []
  let pingFailed = 0
  if (!options.dryRun) {
    for (const r of toPing) {
      const res = await pingGoogleIndexing(r.url)
      if (res.ok) pinged.push(r.url)
      else pingFailed += 1
    }
  }
  const stillStuck = pingable.slice(MAX_PINGS).map((r) => r.url)

  const lines = [
    `🛰️ GSC Index Sweep`,
    `Checked ${results.length} pages: ✅ ${indexed.length} indexed · 🚧 ${pingable.length} not indexed`,
    options.dryRun
      ? `(dry run — no pings fired)`
      : `📡 Force-crawl pings sent: ${pinged.length}${pingFailed ? ` (${pingFailed} failed)` : ''}`,
    pinged.length
      ? `Pinged: ${pinged.slice(0, 12).map(shortPath).join(', ')}${pinged.length > 12 ? ` +${pinged.length - 12} more` : ''}`
      : null,
    stillStuck.length
      ? `⏳ Over daily ping cap, will retry next run: ${stillStuck.length}`
      : null,
    pingable.length === 0
      ? `🎉 Every page checked is indexed.`
      : `These were nudged — re-checks next run; indexing can take days.`,
  ].filter((l): l is string => Boolean(l))
  const digest = lines.join('\n')

  if (!options.skipNotify) {
    await notifyOwner(digest).catch((err) =>
      console.error('[index-sweep] owner notify failed:', err),
    )
  }

  return {
    inspected: results.length,
    indexed: indexed.length,
    notIndexed: pingable.length,
    pinged,
    pingFailed,
    stillStuck,
    digest,
  }
}
