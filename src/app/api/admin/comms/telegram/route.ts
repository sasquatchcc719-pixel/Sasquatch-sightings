/**
 * Site-level Google Search history for the Telegram / Search Rankings pages.
 *
 * Snapshots are the same rows the Monday cron writes, so the charts here and
 * the report on the phone can never disagree.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { GSC_WWW_PROPERTY, GSC_SIGHTINGS_PROPERTY } from '@/lib/gsc'

const HISTORY_LIMIT = 16

type SnapshotRow = {
  clicks: number
  impressions: number
  ctr: number | string
  avg_position: number | string | null
  checked_at: string
}

function toSeries(rows: SnapshotRow[]) {
  // Oldest first so a chart reads left to right.
  return [...rows].reverse().map((row) => ({
    date: row.checked_at,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number(row.ctr),
    position:
      row.avg_position == null || Number(row.avg_position) <= 0
        ? null
        : Number(row.avg_position),
  }))
}

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const load = async (property: string) => {
      const { data, error } = await supabase
        .from('gsc_ranking_snapshots')
        .select('clicks, impressions, ctr, avg_position, checked_at')
        .eq('property', property)
        .order('checked_at', { ascending: false })
        .limit(HISTORY_LIMIT)
      if (error) throw error
      return toSeries((data || []) as SnapshotRow[])
    }

    const [www, sightings] = await Promise.all([
      load(GSC_WWW_PROPERTY),
      load(GSC_SIGHTINGS_PROPERTY),
    ])

    const latestDate = www.at(-1)?.date?.slice(0, 10) ?? null
    let latestCardUrl: string | null = null
    if (latestDate) {
      const {
        data: { publicUrl },
      } = supabase.storage
        .from('job-images')
        .getPublicUrl(`reports/gsc-ranking/${latestDate}.png`)
      latestCardUrl = publicUrl
    }

    return NextResponse.json({
      www,
      sightings,
      latestCardUrl,
    })
  } catch (err) {
    console.error('[admin/comms/telegram][GET]', err)
    return NextResponse.json(
      { error: 'Failed to load search history' },
      { status: 500 },
    )
  }
}
