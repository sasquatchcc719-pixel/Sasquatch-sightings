/**
 * Shared logic for running a Radar SERP scan (used by cron and manual refresh).
 * Fetches rankings for all active keywords via SerpApi and inserts into radar_rankings.
 */

import { createAdminClient } from '@/supabase/server'
import { fetchSerpRanks } from '@/lib/serpApi'

const DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type RadarScanResult = {
  success: boolean
  keywords_processed: number
  rankings_inserted: number
  message?: string
  /** When rankings_inserted is 0 but we had keywords/domains, the first error from SerpApi or insert */
  error_detail?: string
}

export async function runRadarScan(): Promise<RadarScanResult> {
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

  let rankingsInserted = 0
  let firstError: string | undefined

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i]
    try {
      const { ranks, snapshot, mapPack } = await fetchSerpRanks(
        kw.keyword,
        kw.location,
        domains,
      )
      const rows = ranks.map((r) => ({
        keyword_id: kw.id,
        domain_id: r.domain_id,
        rank_position: r.rank_position,
        map_rank: r.map_rank ?? null,
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

      // Persist the full Maps local pack (with review counts) as history so
      // the review gap vs competitors is trackable over time.
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
      console.error(`[Radar Scan] SerpApi error for "${kw.keyword}":`, err)
    }

    if (i < keywords.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  return {
    success: true,
    keywords_processed: keywords.length,
    rankings_inserted: rankingsInserted,
    error_detail: rankingsInserted === 0 && firstError ? firstError : undefined,
  }
}

function normDomain(d: string): string {
  return d
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

/**
 * Build a Telegram digest of where my domain currently ranks in each tracked
 * location's Maps 3-pack, with ↑/↓ vs the previous scan. Returns null when
 * there's nothing to report (no domain/keywords/snapshots).
 */
export async function buildRadarDigest(): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: domains } = await supabase
    .from('radar_domains')
    .select('domain, is_my_domain')
  const mine = domains?.find((d) => d.is_my_domain)
  if (!mine) return null
  const myCore = normDomain(mine.domain)

  const { data: keywords } = await supabase
    .from('radar_keywords')
    .select('id, keyword, location')
    .eq('active', true)
  if (!keywords?.length) return null

  const since = new Date(Date.now() - 5 * 86_400_000).toISOString()
  const { data: snaps } = await supabase
    .from('radar_map_pack_snapshots')
    .select('keyword_id, position, domain, created_at')
    .in(
      'keyword_id',
      keywords.map((k) => k.id),
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (!snaps?.length) return null

  const fmt = (p: number | null) => (p == null ? 'out of 3-pack' : `#${p}`)

  // Group output by keyword text (e.g. "carpet cleaning"), one line per town.
  const groups = new Map<string, string[]>()
  for (const kw of keywords) {
    const rows = snaps.filter((s) => s.keyword_id === kw.id)
    if (!rows.length) continue
    const scans = [...new Set(rows.map((r) => r.created_at))] // newest first
    const rankIn = (ts?: string): number | null => {
      if (!ts) return null
      const r = rows.find(
        (x) => x.created_at === ts && normDomain(x.domain).includes(myCore),
      )
      return r ? r.position : null
    }
    const cur = rankIn(scans[0])
    const prev = rankIn(scans[1])
    let arrow = ''
    if (scans[1]) {
      const c = cur ?? 99
      const p = prev ?? 99
      if (c < p) arrow = ' ↑'
      else if (c > p) arrow = ' ↓'
    }
    const changed = scans[1] && (cur ?? 99) !== (prev ?? 99)
    const icon = cur === 1 ? '🥇' : cur == null ? '⚠️' : '•'
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
  return `🗺️ Radar Daily — map pack rank · ${date}\n\n${sections.join('\n\n')}`
}
