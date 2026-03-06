/**
 * Radar SERP tracking cron job.
 * Fetches rankings for all active keywords via SerpApi and stores in radar_rankings.
 * Schedule in vercel.json. Requires CRON_SECRET and SERPAPI_API_KEY.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { fetchSerpRanks } from '@/lib/serpApi'

const DELAY_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { data: keywords, error: kwError } = await supabase
      .from('radar_keywords')
      .select('id, keyword, location')
      .eq('active', true)

    if (kwError) {
      console.error('[Radar Cron] Keywords fetch error:', kwError)
      return NextResponse.json(
        { error: 'Failed to fetch keywords', details: kwError.message },
        { status: 500 },
      )
    }

    const { data: domains, error: domError } = await supabase
      .from('radar_domains')
      .select('id, domain, display_name, is_my_domain')

    if (domError || !domains?.length) {
      console.error('[Radar Cron] Domains fetch error:', domError)
      return NextResponse.json(
        { error: 'Failed to fetch domains or no domains configured' },
        { status: 500 },
      )
    }

    if (!keywords?.length) {
      return NextResponse.json({
        success: true,
        keywords_processed: 0,
        rankings_inserted: 0,
        message: 'No active keywords',
      })
    }

    let rankingsInserted = 0

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
          console.error(
            `[Radar Cron] Insert error for keyword ${kw.id}:`,
            insertError,
          )
        } else {
          rankingsInserted += rows.length
        }
      } catch (err) {
        console.error(`[Radar Cron] SerpApi error for "${kw.keyword}":`, err)
      }

      if (i < keywords.length - 1) {
        await sleep(DELAY_MS)
      }
    }

    return NextResponse.json({
      success: true,
      keywords_processed: keywords.length,
      rankings_inserted: rankingsInserted,
    })
  } catch (err) {
    console.error('[Radar Cron] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
