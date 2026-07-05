/**
 * Shared logic for running a Radar SERP scan (used by cron and manual refresh).
 * Fetches rankings for all active keywords via SerpApi and inserts into radar_rankings.
 */

import { createAdminClient } from '@/supabase/server'
import { fetchSerpRanks, fetchMapsLocalFinder } from '@/lib/serpApi'
import { SerpApiQuotaError } from '@/lib/serpapi-budget'

const DELAY_MS = 2000
const SERPAPI_CREDITS_PER_KEYWORD = 2
const DEFAULT_RADAR_SERPAPI_DAILY_CREDIT_BUDGET = 6

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RadarKeyword = {
  id: string
  keyword: string
  location: string
}

export type RadarScanOptions = {
  maxSerpApiCredits?: number
}

export type RadarScanResult = {
  success: boolean
  keywords_processed: number
  keywords_available?: number
  keywords_deferred?: number
  serpapi_credits_budgeted?: number
  serpapi_credits_planned?: number
  rankings_inserted: number
  message?: string
  /** When rankings_inserted is 0 but we had keywords/domains, the first error from SerpApi or insert */
  error_detail?: string
}

export function getRadarSerpApiDailyCreditBudget(): number {
  const parsed = Number.parseInt(
    process.env.RADAR_SERP_DAILY_CREDIT_BUDGET || '',
    10,
  )
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_RADAR_SERPAPI_DAILY_CREDIT_BUDGET
  }
  return Math.min(parsed, 20)
}

async function loadLatestScanByKeyword(
  supabase: ReturnType<typeof createAdminClient>,
  keywordIds: string[],
): Promise<Map<string, string>> {
  if (keywordIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('radar_rankings')
    .select('keyword_id, created_at')
    .in('keyword_id', keywordIds)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(keywordIds.length * 40, 100), 5000))

  if (error) {
    console.warn('[Radar Scan] Could not load latest scan timestamps:', error)
    return new Map()
  }

  const latest = new Map<string, string>()
  for (const row of data ?? []) {
    if (!latest.has(row.keyword_id)) {
      latest.set(row.keyword_id, row.created_at)
    }
  }
  return latest
}

function oldestScannedFirst(
  keywords: RadarKeyword[],
  latestScanByKeyword: Map<string, string>,
): RadarKeyword[] {
  const scanTime = (keywordId: string) => {
    const value = latestScanByKeyword.get(keywordId)
    const time = value ? Date.parse(value) : 0
    return Number.isFinite(time) ? time : 0
  }

  return [...keywords].sort((a, b) => {
    const timeDiff = scanTime(a.id) - scanTime(b.id)
    if (timeDiff !== 0) return timeDiff
    return `${a.keyword} ${a.location}`.localeCompare(
      `${b.keyword} ${b.location}`,
    )
  })
}

export async function runRadarScan(
  options: RadarScanOptions = {},
): Promise<RadarScanResult> {
  const supabase = createAdminClient()

  const { data: keywords, error: kwError } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)

  if (kwError) {
    throw new Error(`Failed to fetch keywords: ${kwError.message}`)
  }

  const { data: domains, error: domError } = await supabase
    .from('radar_domains')
    .select('id, domain, display_name, is_my_domain')

  if (domError || !domains?.length) {
    throw new Error(
      domError
        ? `Failed to fetch domains: ${domError.message}`
        : 'No domains configured',
    )
  }

  if (!keywords?.length) {
    return {
      success: true,
      keywords_processed: 0,
      rankings_inserted: 0,
      message: 'No active keywords',
    }
  }

  const maxCredits =
    options.maxSerpApiCredits ?? getRadarSerpApiDailyCreditBudget()
  const keywordLimit = Math.floor(
    Math.max(maxCredits, 0) / SERPAPI_CREDITS_PER_KEYWORD,
  )

  if (keywordLimit < 1) {
    return {
      success: true,
      keywords_processed: 0,
      keywords_available: keywords.length,
      keywords_deferred: keywords.length,
      serpapi_credits_budgeted: maxCredits,
      serpapi_credits_planned: 0,
      rankings_inserted: 0,
      message:
        'Radar scan skipped because the SerpApi daily budget is below one keyword.',
    }
  }

  const latestScanByKeyword = await loadLatestScanByKeyword(
    supabase,
    keywords.map((kw) => kw.id),
  )
  const keywordsToProcess = oldestScannedFirst(
    keywords,
    latestScanByKeyword,
  ).slice(0, keywordLimit)

  let rankingsInserted = 0
  let firstError: string | undefined
  let keywordsProcessed = 0
  let quotaExhausted = false

  for (let i = 0; i < keywordsToProcess.length; i++) {
    const kw = keywordsToProcess[i]
    keywordsProcessed += 1
    try {
      const { ranks, snapshot } = await fetchSerpRanks(
        kw.keyword,
        kw.location,
        domains,
      )

      // Second call: the deep Maps local finder (top ~20). This is what lets us
      // see real positions below the 3-pack (#7, #12, …) and track daily
      // movement. The web 3-pack from fetchSerpRanks only ever has 3 slots.
      await sleep(DELAY_MS)
      const { mapPack, ranksByDomainId } = await fetchMapsLocalFinder(
        kw.keyword,
        kw.location,
        domains,
      )

      const rows = ranks.map((r) => ({
        keyword_id: kw.id,
        domain_id: r.domain_id,
        rank_position: r.rank_position,
        // Deep local-finder position (1–20), null when not in the top 20.
        map_rank: ranksByDomainId.get(r.domain_id) ?? null,
      }))
      const { error: insertError } = await supabase
        .from('radar_rankings')
        .insert(rows)
      if (insertError) {
        const msg = `Insert failed: ${insertError.message}`
        if (!firstError) firstError = msg
        console.error(
          `[Radar Scan] Insert error for keyword ${kw.id}:`,
          insertError,
        )
      } else {
        rankingsInserted += rows.length
      }

      if (snapshot.length > 0) {
        await supabase
          .from('radar_serp_snapshots')
          .delete()
          .eq('keyword_id', kw.id)
        await supabase.from('radar_serp_snapshots').insert(
          snapshot.map((s) => ({
            keyword_id: kw.id,
            position: s.position,
            domain: s.domain,
            ...(s.rating != null && { rating: s.rating }),
            ...(s.reviews != null && { reviews: s.reviews }),
            ...(s.address && { address: s.address }),
          })),
        )
      }

      // Persist the full Maps local finder (top ~20, with review counts) as
      // history so the review gap vs competitors is trackable over time.
      if (mapPack.length > 0) {
        const { error: mapPackError } = await supabase
          .from('radar_map_pack_snapshots')
          .insert(
            mapPack.map((p) => ({
              keyword_id: kw.id,
              position: p.position,
              title: p.title,
              domain: p.domain,
              rating: p.rating,
              reviews: p.reviews,
              address: p.address,
            })),
          )
        if (mapPackError) {
          console.error(
            `[Radar Scan] Map pack insert error for keyword ${kw.id}:`,
            mapPackError,
          )
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!firstError) firstError = msg
      if (err instanceof SerpApiQuotaError) {
        quotaExhausted = true
        console.warn(`[Radar Scan] SerpApi budget stopped scan: ${msg}`)
        break
      }
      console.error(`[Radar Scan] SerpApi error for "${kw.keyword}":`, err)
    }

    if (i < keywordsToProcess.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  const keywordsDeferred = Math.max(keywords.length - keywordsProcessed, 0)
  const messageParts: string[] = []
  if (keywordsDeferred > 0) {
    messageParts.push(
      `Processed ${keywordsProcessed} of ${keywords.length} active keywords; ${keywordsDeferred} deferred for the SerpApi budget.`,
    )
  }
  if (quotaExhausted) {
    messageParts.push('SerpApi monthly quota gate stopped the scan.')
  }

  return {
    success: true,
    keywords_processed: keywordsProcessed,
    keywords_available: keywords.length,
    keywords_deferred: keywordsDeferred,
    serpapi_credits_budgeted: maxCredits,
    serpapi_credits_planned:
      keywordsToProcess.length * SERPAPI_CREDITS_PER_KEYWORD,
    rankings_inserted: rankingsInserted,
    ...(messageParts.length > 0 && { message: messageParts.join(' ') }),
    error_detail: rankingsInserted === 0 && firstError ? firstError : undefined,
  }
}

/** How deep we report a true position before collapsing to "20+". */
const MAPS_DEPTH = 20

/**
 * Build a Telegram digest of where my Google Business Profile currently ranks
 * in each tracked town's Maps local finder (top ~20, not just the 3-pack), with
 * ↑/↓ vs the previous scan. Reads the name-matched map_rank from radar_rankings,
 * so it works even when Maps omits a competitor's website URL. Returns null when
 * there's nothing to report (no domain/keywords/rankings).
 */
export async function buildRadarDigest(): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: domains } = await supabase
    .from('radar_domains')
    .select('id, is_my_domain')
  const myDomainIds = (domains ?? [])
    .filter((d) => d.is_my_domain)
    .map((d) => d.id)
  if (myDomainIds.length === 0) return null

  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)
  if (!keywords?.length) return null

  const since = new Date(Date.now() - 5 * 86_400_000).toISOString()
  const { data: ranks } = await supabase
    .from('radar_rankings')
    .select('keyword_id, map_rank, created_at')
    .in(
      'keyword_id',
      keywords.map((k) => k.id),
    )
    .in('domain_id', myDomainIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (!ranks?.length) return null

  const fmt = (p: number | null) =>
    p == null ? `not in top ${MAPS_DEPTH}` : `#${p}`

  // Best (lowest) map_rank across my domains for a given scan timestamp.
  const rankAt = (rows: { map_rank: number | null }[]): number | null => {
    const positions = rows
      .map((r) => r.map_rank)
      .filter((p): p is number => p != null)
    return positions.length ? Math.min(...positions) : null
  }

  // Group output by keyword text (e.g. "carpet cleaning"), one line per town.
  const groups = new Map<string, string[]>()
  for (const kw of keywords) {
    const rows = ranks.filter((s) => s.keyword_id === kw.id)
    if (!rows.length) continue
    const scans = [...new Set(rows.map((r) => r.created_at))] // newest first
    const cur = rankAt(rows.filter((r) => r.created_at === scans[0]))
    const prev = scans[1]
      ? rankAt(rows.filter((r) => r.created_at === scans[1]))
      : null
    let arrow = ''
    if (scans[1]) {
      const c = cur ?? 99
      const p = prev ?? 99
      if (c < p) arrow = ' ↑'
      else if (c > p) arrow = ' ↓'
    }
    const changed = scans[1] && (cur ?? 99) !== (prev ?? 99)
    const icon = cur === 1 ? '🥇' : cur == null ? '⚠️' : cur <= 3 ? '🟢' : '•'
    const town = kw.location.split(',')[0].trim()
    const line = `${icon} ${town}: ${fmt(cur)}${arrow}${
      changed ? ` (was ${fmt(prev)})` : ''
    }`
    const list = groups.get(kw.keyword) ?? []
    list.push(line)
    groups.set(kw.keyword, list)
  }
  if (groups.size === 0) return null

  const date = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
  })
  const sections = [...groups.entries()].map(
    ([keyword, lines]) => `📍 ${keyword}\n${lines.join('\n')}`,
  )
  return `🗺️ Radar Daily — Maps rank (top ${MAPS_DEPTH}) · ${date}\n\n${sections.join(
    '\n\n',
  )}\n\n🥇 #1 · 🟢 in the 3-pack · ⚠️ not in top ${MAPS_DEPTH}`
}
