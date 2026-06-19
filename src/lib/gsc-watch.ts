/**
 * Weekly GSC index-coverage watch.
 * Inspects the key page set (marketing sitemap + newest job pages), snapshots
 * coverage to gsc_page_snapshots, diffs against the previous run, attempts
 * safe auto-remediation (resubmit sitemaps Google hasn't fetched in 7+ days),
 * and produces a Telegram digest for Charles.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSearchConsoleClient,
  inspectUrl,
  listSitemapStatuses,
  queryTotals,
  fetchSitemapUrls,
  GSC_WWW_PROPERTY,
  GSC_SIGHTINGS_PROPERTY,
  type GscInspection,
} from '@/lib/gsc'
import { sendTelegramNotification } from '@/lib/telegram'

const MAX_INSPECTIONS = 80
const INSPECT_CONCURRENCY = 4
const SITEMAP_STALE_DAYS = 7
/** Coverage states that count as "live in Google's index". */
const INDEXED_STATES = new Set([
  'Submitted and indexed',
  'Indexed, not submitted in sitemap',
])

export type GscWatchResult = {
  inspected: number
  indexed: number
  discoveredNotIndexed: number
  unknown: number
  newlyIndexed: string[]
  droppedFromIndex: string[]
  staleSitemaps: string[]
  resubmitted: string[]
  digest: string
}

function shortPath(url: string): string {
  return (
    url.replace(/https:\/\/(www\.|sightings\.)?sasquatchcarpet\.com/, '') || '/'
  )
}

async function collectTargets(): Promise<
  Array<{ property: string; url: string }>
> {
  const targets: Array<{ property: string; url: string }> = []
  const main = await fetchSitemapUrls(
    'https://www.sasquatchcarpet.com/sitemap.xml',
  )
  for (const url of main.filter((u) => !u.endsWith('llms.txt'))) {
    targets.push({ property: GSC_WWW_PROPERTY, url })
  }
  const jobs = await fetchSitemapUrls(
    'https://www.sasquatchcarpet.com/sitemap-jobs.xml',
  )
  for (const url of jobs.slice(
    0,
    Math.max(0, MAX_INSPECTIONS - targets.length),
  )) {
    targets.push({ property: GSC_WWW_PROPERTY, url })
  }
  return targets.slice(0, MAX_INSPECTIONS)
}

export async function runGscWatch(
  supabase: SupabaseClient,
  options: {
    notifyOwner?: (text: string) => Promise<unknown>
    /** Override the inspected URL set (tests use a tiny list). */
    targets?: Array<{ property: string; url: string }>
  } = {},
): Promise<GscWatchResult> {
  const notifyOwner =
    options.notifyOwner ?? ((text: string) => sendTelegramNotification(text))
  const sc = getSearchConsoleClient()
  const targets = options.targets ?? (await collectTargets())

  // Previous snapshot (most recent coverage per URL) for diffing.
  const { data: prevRows } = await supabase
    .from('gsc_page_snapshots')
    .select('url, coverage, checked_at')
    .order('checked_at', { ascending: false })
    .limit(2000)
  const prevCoverage = new Map<string, string>()
  for (const row of prevRows || []) {
    if (!prevCoverage.has(row.url))
      prevCoverage.set(row.url, row.coverage || '')
  }

  // Inspect with modest concurrency (quota: 600/min, 2000/day per property).
  const results: GscInspection[] = []
  let cursor = 0
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++]
      try {
        results.push(await inspectUrl(sc, t.property, t.url))
      } catch (err) {
        console.error(`[gsc-watch] inspect failed for ${t.url}:`, err)
      }
    }
  }
  await Promise.all(Array.from({ length: INSPECT_CONCURRENCY }, worker))

  // Snapshot to DB.
  if (results.length > 0) {
    const { error } = await supabase.from('gsc_page_snapshots').insert(
      results.map((r) => ({
        property: r.property,
        url: r.url,
        coverage: r.coverage,
        verdict: r.verdict,
        last_crawl_at: r.lastCrawlAt,
      })),
    )
    if (error) console.error('[gsc-watch] snapshot insert failed:', error)
  }

  // Tally + diff.
  let indexed = 0
  let discovered = 0
  let unknown = 0
  const newlyIndexed: string[] = []
  const droppedFromIndex: string[] = []
  for (const r of results) {
    const cov = r.coverage || ''
    if (INDEXED_STATES.has(cov)) indexed += 1
    else if (cov.startsWith('Discovered')) discovered += 1
    else if (cov.includes('unknown')) unknown += 1
    const prev = prevCoverage.get(r.url)
    if (prev !== undefined) {
      const wasIndexed = INDEXED_STATES.has(prev)
      const isIndexed = INDEXED_STATES.has(cov)
      if (!wasIndexed && isIndexed) newlyIndexed.push(shortPath(r.url))
      if (wasIndexed && !isIndexed) droppedFromIndex.push(shortPath(r.url))
    }
  }

  // Sitemap freshness + safe auto-remediation. With a readonly token the
  // resubmit throws — we fall back to surfacing the staleness in the digest.
  const staleSitemaps: string[] = []
  const resubmitted: string[] = []
  for (const property of [GSC_WWW_PROPERTY, GSC_SIGHTINGS_PROPERTY]) {
    try {
      const sitemaps = await listSitemapStatuses(sc, property)
      for (const s of sitemaps) {
        const ageDays = s.lastDownloaded
          ? (Date.now() - Date.parse(s.lastDownloaded)) / 86_400_000
          : Infinity
        if (ageDays > SITEMAP_STALE_DAYS) {
          try {
            await sc.sitemaps.submit({ siteUrl: property, feedpath: s.path })
            resubmitted.push(s.path)
          } catch {
            staleSitemaps.push(
              `${s.path} (${Number.isFinite(ageDays) ? `${Math.round(ageDays)}d` : 'never'})`,
            )
          }
        }
      }
    } catch (err) {
      console.error(`[gsc-watch] sitemap check failed for ${property}:`, err)
    }
  }

  // Week-over-week search totals.
  let trafficLine = ''
  try {
    const [thisWeek, lastWeek] = await Promise.all([
      queryTotals(sc, GSC_WWW_PROPERTY, 8, 1),
      queryTotals(sc, GSC_WWW_PROPERTY, 15, 8),
    ])
    const delta = (a: number, b: number) =>
      a - b >= 0 ? `+${a - b}` : `${a - b}`
    trafficLine = `📈 Search 7d: ${thisWeek.clicks} clicks (${delta(thisWeek.clicks, lastWeek.clicks)}), ${thisWeek.impressions} impressions (${delta(thisWeek.impressions, lastWeek.impressions)})`
  } catch (err) {
    console.error('[gsc-watch] analytics pull failed:', err)
  }

  const lines = [
    `📊 GSC Weekly Watch`,
    `Index coverage (${results.length} pages checked): ✅ ${indexed} indexed · 🕓 ${discovered} discovered-not-crawled · ❓ ${unknown} unknown`,
    newlyIndexed.length
      ? `🎉 Newly indexed: ${newlyIndexed.slice(0, 8).join(', ')}`
      : null,
    droppedFromIndex.length
      ? `🚨 DROPPED FROM INDEX: ${droppedFromIndex.slice(0, 8).join(', ')} — needs attention`
      : null,
    resubmitted.length
      ? `🔁 Auto-resubmitted sitemaps: ${resubmitted.join(', ')}`
      : null,
    staleSitemaps.length
      ? `🐌 Stale sitemaps (Google not fetching): ${staleSitemaps.join(', ')}`
      : null,
    trafficLine || null,
  ].filter((l): l is string => Boolean(l))
  const digest = lines.join('\n')

  await notifyOwner(digest).catch((err) =>
    console.error('[gsc-watch] owner notify failed:', err),
  )

  return {
    inspected: results.length,
    indexed,
    discoveredNotIndexed: discovered,
    unknown,
    newlyIndexed,
    droppedFromIndex,
    staleSitemaps,
    resubmitted,
    digest,
  }
}
