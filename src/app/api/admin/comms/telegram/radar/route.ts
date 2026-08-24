/**
 * Radar Daily dashboard payload: last digest, town ranks, keywords, pins.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { requireAnyRole } from '@/lib/auth'
import { buildRadarDigest } from '@/lib/radar-scan'
import { DATAFORSEO_MAPS_ZOOM } from '@/lib/dataforseo'
import { TOWN_CENTROIDS, townKeyFromLocation } from '@/lib/serpApi'

const NOT_FOUND_RANK = 50

export async function GET() {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()

    const [{ data: keywords }, { data: domains }, digest] = await Promise.all([
      supabase
        .from('radar_keywords')
        .select('id, keyword, location, active')
        .order('keyword')
        .order('location'),
      supabase
        .from('radar_domains')
        .select('id, domain, display_name, is_my_domain')
        .order('is_my_domain', { ascending: false })
        .order('display_name'),
      buildRadarDigest(),
    ])

    const mine = (domains ?? []).filter((d) => d.is_my_domain).map((d) => d.id)
    const active = (keywords ?? []).filter((k) => k.active)
    const since = new Date(Date.now() - 5 * 86_400_000).toISOString()

    const { data: ranks } = active.length
      ? await supabase
          .from('radar_rankings')
          .select('keyword_id, domain_id, map_rank, rank_position, created_at')
          .in(
            'keyword_id',
            active.map((k) => k.id),
          )
          .in(
            'domain_id',
            mine.length ? mine : ['00000000-0000-0000-0000-000000000000'],
          )
          .gte('created_at', since)
          .order('created_at', { ascending: false })
      : { data: [] }

    const towns = active.map((kw) => {
      const rows = (ranks ?? []).filter((r) => r.keyword_id === kw.id)
      const stamps = [...new Set(rows.map((r) => r.created_at))]
      const current = rows.filter((r) => r.created_at === stamps[0])
      const previous = stamps[1]
        ? rows.filter((r) => r.created_at === stamps[1])
        : []
      const maps = current
        .map((r) => r.map_rank)
        .filter((p): p is number => p != null)
      const organic = current
        .map((r) => r.rank_position)
        .filter((p): p is number => p != null && p < NOT_FOUND_RANK)
      const prevMaps = previous
        .map((r) => r.map_rank)
        .filter((p): p is number => p != null)
      const key = townKeyFromLocation(kw.location)
      const pin = TOWN_CENTROIDS[key] ?? null
      return {
        keywordId: kw.id,
        keyword: kw.keyword,
        location: kw.location,
        town: kw.location.split(',')[0].trim(),
        townKey: key,
        mapsRank: maps.length ? Math.min(...maps) : null,
        organicRank: organic.length ? Math.min(...organic) : null,
        prevMapsRank: prevMaps.length ? Math.min(...prevMaps) : null,
        scannedAt: stamps[0] ?? null,
        pin,
        zoom: DATAFORSEO_MAPS_ZOOM,
      }
    })

    const lastSent = towns
      .map((t) => t.scannedAt)
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1)

    return NextResponse.json({
      digest,
      lastSent,
      keywords: keywords ?? [],
      domains: domains ?? [],
      towns,
      availablePins: Object.entries(TOWN_CENTROIDS).map(([townKey, pin]) => ({
        townKey,
        ...pin,
      })),
    })
  } catch (err) {
    console.error('[admin/comms/telegram/radar]', err)
    return NextResponse.json(
      { error: 'Failed to load Radar Daily' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    const body = (await request.json()) as {
      keyword?: string
      location?: string
    }
    if (!body.keyword?.trim() || !body.location?.trim()) {
      return NextResponse.json(
        { error: 'keyword and location are required' },
        { status: 400 },
      )
    }
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('radar_keywords')
      .insert({
        keyword: body.keyword.trim(),
        location: body.location.trim(),
        active: true,
      })
      .select('id, keyword, location, active')
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    console.error('[admin/comms/telegram/radar POST]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to add' },
      { status: 500 },
    )
  }
}
