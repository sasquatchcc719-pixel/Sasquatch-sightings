import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { GSC_WWW_PROPERTY } from '@/lib/gsc'

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()
    const { data: latest } = await supabase
      .from('gsc_keyword_snapshots')
      .select('checked_at')
      .eq('property', GSC_WWW_PROPERTY)
      .order('checked_at', { ascending: false })
      .limit(1)
    const checkedAt = latest?.[0]?.checked_at ?? null
    if (!checkedAt) {
      return NextResponse.json({
        lastSent: null,
        digest: null,
        closeCalls: [],
        constants: {
          windowDays: 28,
          minPosition: 8,
          maxPosition: 20.5,
          minImpressions: 5,
          maxOpportunities: 6,
        },
      })
    }
    const { data: rows } = await supabase
      .from('gsc_keyword_snapshots')
      .select('keyword, page, clicks, impressions, avg_position')
      .eq('property', GSC_WWW_PROPERTY)
      .eq('checked_at', checkedAt)
      .order('impressions', { ascending: false })

    const closeCalls = (rows ?? [])
      .filter((r) => {
        const pos = Number(r.avg_position)
        return Number(r.impressions) >= 5 && pos >= 8 && pos <= 20.5
      })
      .slice(0, 6)

    const digest =
      closeCalls.length === 0
        ? `Monthly SEO Opportunities (last 28d)\n\nNo page-2 keywords cleared the volume threshold this month.`
        : [
            'Monthly SEO Opportunities (last 28d)',
            "Keywords you're close on (page 2 / edge of page 1):",
            '',
            ...closeCalls.map(
              (r, i) =>
                `${i + 1}. "${r.keyword}" — pos ${Number(r.avg_position).toFixed(1)} · ${r.impressions} searches · ${r.clicks} clicks`,
            ),
          ].join('\n')

    return NextResponse.json({
      lastSent: checkedAt,
      digest,
      closeCalls,
      constants: {
        windowDays: 28,
        minPosition: 8,
        maxPosition: 20.5,
        minImpressions: 5,
        maxOpportunities: 6,
      },
    })
  } catch (err) {
    console.error('[admin/comms/telegram/opportunities]', err)
    return NextResponse.json(
      { error: 'Failed to load close calls' },
      { status: 500 },
    )
  }
}
