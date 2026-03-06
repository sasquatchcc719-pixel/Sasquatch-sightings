/**
 * Build a short Radar SERP summary for a domain (for dossier deep-dive context).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function getRadarSummaryForDomain(
  supabase: SupabaseClient,
  domainId: string,
  domainStr: string,
): Promise<string> {
  const normDomain = domainStr.toLowerCase().replace(/^www\./, '')

  const { data: rankings } = await supabase
    .from('radar_rankings')
    .select(
      'rank_position, map_rank, created_at, radar_keywords(keyword, location)',
    )
    .eq('domain_id', domainId)
    .order('created_at', { ascending: false })
    .limit(15)

  const { data: snapshots } = await supabase
    .from('radar_serp_snapshots')
    .select(
      'position, rating, reviews, address, radar_keywords(keyword, location)',
    )
    .ilike('domain', normDomain)
    .order('created_at', { ascending: false })
    .limit(10)

  const lines: string[] = []

  if (rankings?.length) {
    lines.push('Recent rankings:')
    for (const r of rankings) {
      const kw = (
        r as { radar_keywords?: { keyword?: string; location?: string } | null }
      ).radar_keywords
      const kwLabel = kw ? `${kw.keyword ?? '?'} (${kw.location ?? '?'})` : '?'
      const mapStr =
        (r as { map_rank?: number | null }).map_rank != null
          ? `, map #${(r as { map_rank: number }).map_rank}`
          : ''
      lines.push(
        `  ${kwLabel}: organic #${(r as { rank_position: number }).rank_position}${mapStr}`,
      )
    }
  }

  if (snapshots?.length) {
    lines.push('Seen in local pack:')
    for (const s of snapshots) {
      const kw = (s as { radar_keywords?: { keyword?: string } | null })
        .radar_keywords
      const rating = (s as { rating?: number | null }).rating
      const reviews = (s as { reviews?: number | null }).reviews
      const address = (s as { address?: string | null }).address
      const parts = [
        kw?.keyword ?? '?',
        rating != null ? `${rating} stars` : '',
        reviews != null ? `${reviews} reviews` : '',
        address ?? '',
      ].filter(Boolean)
      lines.push(`  ${parts.join(', ')}`)
    }
  }

  if (lines.length === 0)
    return 'No ranking or snapshot data yet for this domain.'
  return lines.join('\n')
}
