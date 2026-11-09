/**
 * Cron: monthly Google Search Console "page-2 opportunity" report.
 * Finds keywords ranking just off page 1, reads the live page, asks OpenAI what
 * content gaps to fill, and returns recommendations for review. Never edits the site — recommendations only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runGscOpportunities } from '@/lib/gsc-opportunities'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runGscOpportunities()
    return NextResponse.json({
      success: true,
      analyzed: result.analyzed,
      opportunities: result.opportunities.map((o) => ({
        keyword: o.keyword,
        page: o.page,
        position: o.position,
        impressions: o.impressions,
        clicks: o.clicks,
        recommendation: o.recommendation ?? null,
      })),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'GSC opportunities failed'
    console.error('[cron/gsc-opportunities] Error:', error)
    // SEO Telegram delivery is retired; preserve the logged error and HTTP status.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
