/**
 * Local Falcon workspace data.
 *
 * GET  ?view=scans|trends|competitors|campaigns|guard|reviews|account|locations
 *      &scanId=  — points for a scan
 *      &competitorId= — competitor heatmap points
 * POST { action: 'sync' | 'run-scan' | campaign*|guard* ... }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAnyRole } from '@/lib/auth'
import { createAdminClient } from '@/supabase/server'
import { syncAllLocalFalcon } from '@/lib/ops/local-falcon-sync'
import {
  addGuardLocations,
  createCampaign,
  deleteGuard,
  listLocations,
  lfCollection,
  pauseCampaign,
  pauseGuard,
  reactivateCampaign,
  resumeCampaign,
  resumeGuard,
  runCampaign,
  runScan,
  scanCost,
  type LFPlatform,
} from '@/lib/local-falcon'

export const maxDuration = 300

const SCAN_SELECT =
  'id, report_key, keyword, platform, scanned_at, grid_size, radius, measurement, center_lat, center_lng, arp, atrp, solv, saiv, osolv, found_in, points_total, unique_competitors, public_url, insights, location, ai_analysis, rankings, heatmap_url, image_url, campaign_key'

export async function GET(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner', 'marketing'])
    const supabase = createAdminClient()
    const view = request.nextUrl.searchParams.get('view') || 'scans'

    if (view === 'account') {
      const { data } = await supabase
        .from('local_falcon_account_snapshot')
        .select('*')
        .eq('id', 1)
        .maybeSingle()
      return NextResponse.json({ ok: true, account: data })
    }

    if (view === 'trends') {
      const { data, error } = await supabase
        .from('local_falcon_trend_reports')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return NextResponse.json({ ok: true, trends: data ?? [] })
    }

    if (view === 'competitors') {
      const { data: reports, error } = await supabase
        .from('local_falcon_competitor_reports')
        .select('*')
        .order('scanned_at', { ascending: false })
        .limit(50)
      if (error) throw error
      const competitorId = request.nextUrl.searchParams.get('competitorId')
      let points: unknown[] = []
      if (competitorId) {
        const { data, error: pErr } = await supabase
          .from('local_falcon_competitor_points')
          .select('*')
          .eq('report_id', competitorId)
          .order('idx')
          .limit(5000)
        if (pErr) throw pErr
        points = data ?? []
      }
      return NextResponse.json({
        ok: true,
        competitors: reports ?? [],
        points,
      })
    }

    if (view === 'campaigns') {
      const { data, error } = await supabase
        .from('local_falcon_campaigns')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return NextResponse.json({ ok: true, campaigns: data ?? [] })
    }

    if (view === 'guard') {
      const { data: locations, error } = await supabase
        .from('local_falcon_guard_locations')
        .select('*')
        .order('synced_at', { ascending: false })
      if (error) throw error
      const { data: reports } = await supabase
        .from('local_falcon_guard_reports')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(20)
      return NextResponse.json({
        ok: true,
        guardLocations: locations ?? [],
        guardReports: reports ?? [],
      })
    }

    if (view === 'reviews') {
      const { data, error } = await supabase
        .from('local_falcon_reviews_reports')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return NextResponse.json({ ok: true, reviews: data ?? [] })
    }

    if (view === 'locations') {
      // Live from Falcon — saved locations for run-scan place picker.
      if (!process.env.LOCAL_FALCON_API_KEY) {
        return NextResponse.json({ ok: true, locations: [] })
      }
      const listed = await listLocations({ limit: 50 })
      return NextResponse.json({
        ok: true,
        locations: lfCollection(listed, 'locations'),
      })
    }

    // Default: scans workspace
    const { data: scans, error } = await supabase
      .from('local_falcon_scans')
      .select(SCAN_SELECT)
      .order('scanned_at', { ascending: false })
      .limit(50)
    if (error) throw error

    const requested = request.nextUrl.searchParams.get('scanId')
    const active = requested
      ? (scans ?? []).find((s) => s.id === requested)
      : (scans ?? [])[0]

    let points: unknown[] = []
    if (active) {
      const { data, error: pErr } = await supabase
        .from('local_falcon_points')
        .select('idx, lat, lng, found, rank, competitors')
        .eq('scan_id', active.id)
        .order('idx')
      if (pErr) throw pErr
      points = data ?? []
    }

    const { data: account } = await supabase
      .from('local_falcon_account_snapshot')
      .select('credits, email, synced_at')
      .eq('id', 1)
      .maybeSingle()

    return NextResponse.json({
      ok: true,
      scans: scans ?? [],
      scan: active ?? null,
      points,
      account,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[local-falcon GET]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAnyRole(['admin', 'owner'])
    if (!process.env.LOCAL_FALCON_API_KEY) {
      return NextResponse.json(
        { error: 'LOCAL_FALCON_API_KEY is not configured' },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const action = String(body.action || 'sync')
    const supabase = createAdminClient()

    if (action === 'sync') {
      const result = await syncAllLocalFalcon(supabase, {
        limit: 50,
        upgradeExisting: Boolean(body.upgradeExisting ?? true),
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (action === 'run-scan') {
      const place_id = String(body.place_id || '').trim()
      const keyword = String(body.keyword || '').trim()
      const grid_size = Math.round(Number(body.grid_size))
      const radius = Number(body.radius)
      const lat = Number(body.lat)
      const lng = Number(body.lng)
      const platform = String(body.platform || 'google') as LFPlatform
      const measurement = body.measurement === 'km' ? 'km' : 'mi'
      const ai_analysis = Boolean(body.ai_analysis ?? true)
      if (!place_id || !keyword) {
        return NextResponse.json(
          { error: 'place_id and keyword are required' },
          { status: 400 },
        )
      }
      if (![3, 5, 7, 9, 11, 13, 15, 17, 19, 21].includes(grid_size)) {
        return NextResponse.json(
          { error: 'grid_size must be an odd size 3–21' },
          { status: 400 },
        )
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return NextResponse.json(
          { error: 'lat and lng are required' },
          { status: 400 },
        )
      }
      if (!Number.isFinite(radius) || radius < 0.1 || radius > 100) {
        return NextResponse.json(
          { error: 'radius must be 0.1–100' },
          { status: 400 },
        )
      }
      // Confirm flag required so the UI can't accidentally burn credits.
      if (body.confirm !== true) {
        return NextResponse.json({
          ok: false,
          needsConfirm: true,
          credits: scanCost(grid_size),
          message: `This will spend ${scanCost(grid_size)} Local Falcon credits`,
        })
      }
      const result = await runScan({
        place_id,
        keyword,
        grid_size,
        radius,
        measurement,
        lat,
        lng,
        platform,
        ai_analysis,
        eager: true,
      })
      // Pull fresh data so the new report shows up quickly.
      await syncAllLocalFalcon(supabase, { limit: 10, upgradeExisting: false })
      return NextResponse.json({
        ok: true,
        credits: scanCost(grid_size),
        result,
      })
    }

    if (action === 'campaign-create') {
      const result = await createCampaign({
        name: String(body.name || ''),
        measurement: body.measurement === 'km' ? 'km' : 'mi',
        grid_size: Number(body.grid_size || 9),
        radius: Number(body.radius || 8),
        frequency: (String(body.frequency || 'weekly') as
          | 'one-time'
          | 'daily'
          | 'weekly'
          | 'biweekly'
          | 'monthly'),
        place_id: String(body.place_id || ''),
        keyword: String(body.keyword || ''),
        start_date: String(body.start_date || ''),
        start_time: String(body.start_time || '9:00 AM'),
        ai_analysis: Boolean(body.ai_analysis),
        notify: Boolean(body.notify),
        email_recipients: body.email_recipients
          ? String(body.email_recipients)
          : undefined,
        email_subject: body.email_subject
          ? String(body.email_subject)
          : undefined,
        email_body: body.email_body ? String(body.email_body) : undefined,
      })
      await syncAllLocalFalcon(supabase, { limit: 10 })
      return NextResponse.json({ ok: true, result })
    }

    if (action === 'campaign-run') {
      const key = String(body.campaign_key || '')
      if (!key) {
        return NextResponse.json(
          { error: 'campaign_key required' },
          { status: 400 },
        )
      }
      if (body.confirm !== true) {
        return NextResponse.json({
          ok: false,
          needsConfirm: true,
          message: 'Confirm to run this campaign (spends credits)',
        })
      }
      const result = await runCampaign(key)
      return NextResponse.json({ ok: true, result })
    }

    if (action === 'campaign-pause') {
      const result = await pauseCampaign(String(body.campaign_key || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }

    if (action === 'campaign-resume') {
      const result = await resumeCampaign({
        campaign_key: String(body.campaign_key || ''),
        start_date: body.start_date ? String(body.start_date) : undefined,
        start_time: body.start_time ? String(body.start_time) : undefined,
      })
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }

    if (action === 'campaign-reactivate') {
      const result = await reactivateCampaign(String(body.campaign_key || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }

    if (action === 'guard-add') {
      const result = await addGuardLocations(String(body.place_id || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }
    if (action === 'guard-pause') {
      const result = await pauseGuard(String(body.place_id || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }
    if (action === 'guard-resume') {
      const result = await resumeGuard(String(body.place_id || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }
    if (action === 'guard-delete') {
      const result = await deleteGuard(String(body.place_id || ''))
      await syncAllLocalFalcon(supabase, { limit: 5 })
      return NextResponse.json({ ok: true, result })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action failed'
    const status = /unauthor|forbidden|role/i.test(message) ? 403 : 500
    console.error('[local-falcon POST]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
