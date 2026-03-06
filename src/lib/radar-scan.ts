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
      const ranks = await fetchSerpRanks(kw.keyword, kw.location, domains)
      const rows = ranks.map((r) => ({
        keyword_id: kw.id,
        domain_id: r.domain_id,
        rank_position: r.rank_position,
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
