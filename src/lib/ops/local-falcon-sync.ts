/**
 * Pull Local Falcon products into our own tables.
 *
 * Reading reports costs no credits — only run-scan / campaigns do.
 * Local Falcon returns everything as strings (PHP-flavoured), so every numeric
 * field goes through coercion that turns '' and 'null' into null rather than 0.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getAccount,
  getCampaign,
  getCompetitorReport,
  getGuardReport,
  getKeywordReport,
  getLocationReport,
  getReport,
  getReviewsReport,
  getTrendReport,
  listCampaigns,
  listCompetitorReports,
  listGuardLocations,
  listKeywordReports,
  listLocationReports,
  listReports,
  listReviewsReports,
  listTrendReports,
  lfCollection,
} from '@/lib/local-falcon'

/** '' | 'null' | undefined -> null. Everything else -> Number, or null if NaN. */
export function lfNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  // Falcon AI platforms send `rank: false` on misses. Never treat that as 0.
  if (typeof value === 'boolean') return null
  const s = String(value).trim()
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'false') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function lfInt(value: unknown): number | null {
  const n = lfNum(value)
  return n === null ? null : Math.round(n)
}

export type SyncBucket = {
  checked: number
  inserted: number
  updated: number
  skipped: number
  errors: string[]
}

export type FullSyncResult = {
  scans: SyncBucket
  competitors: SyncBucket
  trends: SyncBucket
  locations: SyncBucket
  keywords: SyncBucket
  campaigns: SyncBucket
  guard: SyncBucket
  reviews: SyncBucket
  account: { ok: boolean; error?: string }
}

function emptyBucket(): SyncBucket {
  return { checked: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }
}

type RawPoint = {
  lat?: string | number
  lng?: string | number
  found?: boolean
  /** Falcon sometimes sends boolean `false` (not null) on AI-platform misses. */
  rank?: number | string | boolean | null
  results?: Array<Record<string, unknown>>
}

/**
 * Keep full top-20 competitor rows per grid point (Falcon max), trimmed of
 * bulky category maps so we don't store megabytes per scan.
 */
export function normalizeCompetitors(results: RawPoint['results']): unknown[] {
  if (!Array.isArray(results)) return []
  return results.slice(0, 20).map((r) => ({
    rank: lfInt(r.rank),
    place_id: r.place_id ?? null,
    name: r.name ?? null,
    rating: lfNum(r.rating),
    reviews: lfInt(r.reviews),
    address: r.address ?? null,
    phone: r.phone ?? null,
    url: r.url ?? null,
  }))
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function reportScannedAt(r: Record<string, unknown>): string {
  const ts = lfInt(r.timestamp)
  return ts ? new Date(ts * 1000).toISOString() : new Date().toISOString()
}

function extractOsolv(insights: unknown): number | null {
  const i = asRecord(insights)
  const osolv = asRecord(i.osolv)
  return lfNum(osolv.yours ?? i.osolv)
}

/**
 * Google Maps scans set found/rank on each point. AI platforms (gemini/grok/
 * chatgpt) leave both false and put the business in results[] under ai_place_id.
 */
export function resolvePointPresence(
  p: RawPoint,
  targetPlaceIds: Set<string>,
  targetName?: string | null,
): { found: boolean; rank: number | null } {
  if (p.found === true) {
    return { found: true, rank: lfInt(p.rank) }
  }
  const results = Array.isArray(p.results) ? p.results : []
  const nameNeedle = targetName?.trim().toLowerCase() || ''
  for (const row of results) {
    const pid = String(row.place_id ?? '')
    if (pid && targetPlaceIds.has(pid)) {
      return { found: true, rank: lfInt(row.rank) }
    }
    if (
      nameNeedle &&
      typeof row.name === 'string' &&
      row.name.trim().toLowerCase() === nameNeedle
    ) {
      return { found: true, rank: lfInt(row.rank) }
    }
  }
  return { found: false, rank: null }
}

function targetIdsFromReport(r: Record<string, unknown>): {
  ids: Set<string>
  name: string | null
} {
  const ids = new Set<string>()
  for (const key of ['place_id', 'ai_place_id'] as const) {
    const v = r[key]
    if (typeof v === 'string' && v.trim()) ids.add(v.trim())
  }
  const location = asRecord(r.location)
  if (typeof location.place_id === 'string' && location.place_id.trim()) {
    ids.add(location.place_id.trim())
  }
  const name =
    typeof location.name === 'string' && location.name.trim()
      ? location.name.trim()
      : null
  return { ids, name }
}

async function upsertScanFromReport(
  supabase: SupabaseClient,
  reportKey: string,
  r: Record<string, unknown>,
  options?: { replacePoints?: boolean },
): Promise<'inserted' | 'updated'> {
  const insights = r.insights ?? null
  const row = {
    report_key: reportKey,
    place_id: (r.place_id as string) ?? null,
    keyword: String(r.keyword ?? ''),
    platform: String(r.platform ?? 'google'),
    scanned_at: reportScannedAt(r),
    grid_size: lfInt(r.grid_size),
    radius: lfNum(r.radius),
    measurement: (r.measurement as string) ?? null,
    center_lat: lfNum(r.lat),
    center_lng: lfNum(r.lng),
    arp: lfNum(r.arp),
    atrp: lfNum(r.atrp),
    solv: lfNum(r.solv),
    saiv: lfNum(r.saiv),
    osolv: extractOsolv(insights),
    campaign_key:
      typeof r.campaign_key === 'string'
        ? r.campaign_key
        : typeof r.campaign_report_key === 'string'
          ? r.campaign_report_key
          : null,
    found_in: lfInt(r.found_in),
    points_total: lfInt(r.points),
    unique_competitors: lfInt(r.unique_competitors),
    public_url: (r.public_url as string) ?? null,
    insights,
    location: r.location ?? null,
    ai_analysis: r.ai_analysis ?? null,
    rankings: r.rankings ?? null,
    places: r.places ?? null,
    sources: r.sources ?? null,
    heatmap_url: typeof r.heatmap === 'string' ? r.heatmap : null,
    image_url: typeof r.image === 'string' ? r.image : null,
    raw: r,
  }

  const { data: existing } = await supabase
    .from('local_falcon_scans')
    .select('id')
    .eq('report_key', reportKey)
    .maybeSingle()

  let scanId: string
  let status: 'inserted' | 'updated'
  if (existing?.id) {
    const { error } = await supabase
      .from('local_falcon_scans')
      .update(row)
      .eq('id', existing.id)
    if (error) throw error
    scanId = existing.id
    status = 'updated'
    if (options?.replacePoints) {
      await supabase.from('local_falcon_points').delete().eq('scan_id', scanId)
    } else {
      return status
    }
  } else {
    const { data: scan, error } = await supabase
      .from('local_falcon_scans')
      .insert(row)
      .select('id')
      .single()
    if (error) throw error
    scanId = scan.id
    status = 'inserted'
  }

  const points = (r.data_points ?? []) as RawPoint[]
  if (points.length) {
    const { ids: targetIds, name: targetName } = targetIdsFromReport(r)
    const rows = points.map((p, idx) => {
      const presence = resolvePointPresence(p, targetIds, targetName)
      return {
        scan_id: scanId,
        idx,
        lat: lfNum(p.lat) ?? 0,
        lng: lfNum(p.lng) ?? 0,
        found: presence.found,
        rank: presence.rank,
        competitors: normalizeCompetitors(p.results),
      }
    })
    const { error: pointError } = await supabase
      .from('local_falcon_points')
      .insert(rows)
    if (pointError) throw pointError
  }
  return status
}

/**
 * List scan reports across pages. Falcon's default page is tiny; without
 * pagination, brand-new platforms (e.g. grok) can sit at the top of Falcon's
 * inbox while Sightings only ever re-hydrates an older page of google scans.
 */
async function listAllScanReports(options?: {
  limit?: number
  maxPages?: number
  platform?: string
}): Promise<Record<string, unknown>[]> {
  const pageSize = Math.min(Math.max(options?.limit ?? 50, 1), 100)
  const maxPages = options?.maxPages ?? 5
  const out: Record<string, unknown>[] = []
  let nextToken: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const listed = await listReports({
      limit: pageSize,
      platform: options?.platform,
      next_token: nextToken,
    })
    const data = asRecord(listed)
    const reports = lfCollection(listed, 'reports')
    out.push(...reports)
    const token = data.next_token
    if (typeof token !== 'string' || !token || reports.length === 0) break
    nextToken = token
  }
  return out
}

/**
 * Mirror scan reports.
 *
 * Priority: insert brand-new report_keys first (so Grok/ChatGPT runs that just
 * emailed you show up immediately). Only then backfill a few incomplete rows.
 * Never re-download every known scan on "Sync all" — that used to burn the
 * whole serverless budget upgrading old google grids and skip the new ones.
 */
export async function syncLocalFalconScans(
  supabase: SupabaseClient,
  options?: { limit?: number; upgradeExisting?: boolean; maxUpgrade?: number },
): Promise<SyncBucket> {
  const out = emptyBucket()

  // Pull all platforms explicitly too — Falcon's unfiltered list has been
  // observed to bury AI-platform runs, and platform=grok is cheap/read-only.
  const [mixed, grokOnly, chatgptOnly, geminiOnly] = await Promise.all([
    listAllScanReports({ limit: options?.limit ?? 50 }),
    listAllScanReports({ limit: 25, platform: 'grok', maxPages: 2 }),
    listAllScanReports({ limit: 25, platform: 'chatgpt', maxPages: 2 }),
    listAllScanReports({ limit: 25, platform: 'gemini', maxPages: 2 }),
  ])
  const byKey = new Map<string, Record<string, unknown>>()
  for (const r of [...mixed, ...grokOnly, ...chatgptOnly, ...geminiOnly]) {
    const key = String(r.report_key || '')
    if (key) byKey.set(key, r)
  }
  const reports = [...byKey.values()]
  out.checked = reports.length
  if (!reports.length) return out

  const keys = reports.map((r) => String(r.report_key ?? '')).filter(Boolean)
  const { data: existing } = await supabase
    .from('local_falcon_scans')
    .select('id, report_key, platform, found_in, ai_analysis, raw')
    .in('report_key', keys)
  const have = new Map(
    (existing ?? []).map((r) => [r.report_key as string, r] as const),
  )

  // AI platforms historically stored every point as a miss because Falcon
  // leaves found/rank false and only puts the business in results[].
  const brokenKeys = new Set<string>()
  const existingIds = (existing ?? []).map((r) => r.id as string).filter(Boolean)
  if (existingIds.length) {
    const { data: pointStats } = await supabase
      .from('local_falcon_points')
      .select('scan_id, found')
      .in('scan_id', existingIds)
    const foundByScan = new Map<string, number>()
    for (const p of pointStats ?? []) {
      const sid = String(p.scan_id)
      if (p.found) foundByScan.set(sid, (foundByScan.get(sid) ?? 0) + 1)
    }
    for (const row of existing ?? []) {
      const foundIn = lfInt(row.found_in) ?? 0
      const foundPts = foundByScan.get(String(row.id)) ?? 0
      if (foundIn > 0 && foundPts === 0) {
        brokenKeys.add(String(row.report_key))
      }
    }
  }

  const newKeys: string[] = []
  const repairKeys: string[] = []
  const upgradeKeys: string[] = []
  for (const summary of reports) {
    const reportKey = String(summary.report_key || '')
    if (!reportKey) continue
    const prior = have.get(reportKey)
    if (!prior) {
      newKeys.push(reportKey)
      continue
    }
    if (brokenKeys.has(reportKey)) {
      repairKeys.push(reportKey)
      continue
    }
    const incomplete = prior.raw == null
    if (incomplete || options?.upgradeExisting) upgradeKeys.push(reportKey)
  }

  const maxUpgrade = options?.maxUpgrade ?? (options?.upgradeExisting ? 3 : 5)
  // Prefer new inserts + point repairs before optional upgrades.
  const toFetch = [
    ...newKeys,
    ...repairKeys,
    ...upgradeKeys
      .filter((k) => !newKeys.includes(k) && !repairKeys.includes(k))
      .slice(0, maxUpgrade),
  ]

  for (const reportKey of toFetch) {
    const prior = have.get(reportKey)
    try {
      const raw = (await getReport(reportKey)) as Record<string, unknown>
      const r = asRecord(raw.report ?? raw)
      const status = await upsertScanFromReport(supabase, reportKey, r, {
        replacePoints: Boolean(prior),
      })
      if (status === 'inserted') out.inserted++
      else out.updated++
    } catch (err) {
      out.errors.push(
        `${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  out.skipped = Math.max(0, reports.length - toFetch.length)
  return out
}

async function syncCompetitorReports(
  supabase: SupabaseClient,
  limit = 25,
): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listCompetitorReports({ limit })
    const reports = lfCollection(listed, 'reports')
    out.checked = reports.length
    for (const summary of reports) {
      const reportKey = String(summary.report_key || '')
      if (!reportKey) {
        out.skipped++
        continue
      }
      try {
        const detail = asRecord(await getCompetitorReport(reportKey))
        const r = asRecord(detail.report ?? detail)
        const row = {
          report_key: reportKey,
          place_id: (r.place_id as string) ?? null,
          keyword: (r.keyword as string) ?? null,
          platform: (r.platform as string) ?? null,
          scanned_at: reportScannedAt(r),
          payload: r,
        }
        const { data: upserted, error } = await supabase
          .from('local_falcon_competitor_reports')
          .upsert(row, { onConflict: 'report_key' })
          .select('id')
          .single()
        if (error) throw error

        await supabase
          .from('local_falcon_competitor_points')
          .delete()
          .eq('report_id', upserted.id)

        // Competitor heatmaps live under businesses / competitors with data_points.
        const businessesRaw = r.businesses ?? r.competitors ?? r.places
        const businesses: Record<string, unknown>[] = Array.isArray(businessesRaw)
          ? businessesRaw.map(asRecord)
          : businessesRaw && typeof businessesRaw === 'object'
            ? Object.entries(businessesRaw as Record<string, unknown>).map(
                ([k, v]) => ({ place_id: k, ...asRecord(v) }),
              )
            : []
        const pointRows: Array<Record<string, unknown>> = []
        for (const biz of businesses) {
          const b = asRecord(biz)
          const placeId = String(b.place_id ?? b.id ?? '')
          const name = (b.name as string) ?? null
          const dps = (b.data_points ?? b.points ?? []) as RawPoint[]
          if (!Array.isArray(dps)) continue
          dps.forEach((p, idx) => {
            pointRows.push({
              report_id: upserted.id,
              competitor_place_id: placeId || null,
              competitor_name: name,
              idx,
              lat: lfNum(p.lat),
              lng: lfNum(p.lng),
              rank: p.found === false ? null : lfInt(p.rank),
              payload: p,
            })
          })
        }
        if (pointRows.length) {
          const { error: pErr } = await supabase
            .from('local_falcon_competitor_points')
            .insert(pointRows)
          if (pErr) throw pErr
        }
        out.inserted++
      } catch (err) {
        out.errors.push(
          `competitor ${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `competitor list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncTrendReports(
  supabase: SupabaseClient,
  limit = 25,
): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listTrendReports({
      fieldmask:
        'report_key,place_id,keyword,platform,grid_size,radius,scans',
    })
    const reports = lfCollection(listed, 'reports').slice(0, limit)
    out.checked = reports.length
    for (const summary of reports) {
      const reportKey = String(summary.report_key || '')
      if (!reportKey) {
        out.skipped++
        continue
      }
      try {
        const detail = asRecord(await getTrendReport(reportKey))
        const r = asRecord(detail.report ?? detail)
        const series = Array.isArray(r.scans) ? r.scans : []
        const { error } = await supabase.from('local_falcon_trend_reports').upsert(
          {
            report_key: reportKey,
            place_id: (r.place_id as string) ?? null,
            keyword: (r.keyword as string) ?? null,
            platform: (r.platform as string) ?? null,
            grid_size: lfInt(r.grid_size),
            radius: lfNum(r.radius),
            series,
            payload: r,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'report_key' },
        )
        if (error) throw error
        out.inserted++
      } catch (err) {
        out.errors.push(
          `trend ${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `trend list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncSimpleKeyReports(
  supabase: SupabaseClient,
  table: 'local_falcon_location_reports' | 'local_falcon_keyword_reports',
  listFn: () => Promise<unknown>,
  getFn: (key: string) => Promise<unknown>,
  mapRow: (
    key: string,
    r: Record<string, unknown>,
  ) => Record<string, unknown>,
): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listFn()
    const reports = lfCollection(listed, 'reports')
    out.checked = reports.length
    for (const summary of reports) {
      const reportKey = String(summary.report_key || '')
      if (!reportKey) {
        out.skipped++
        continue
      }
      try {
        const detail = asRecord(await getFn(reportKey))
        const r = asRecord(detail.report ?? detail)
        const { error } = await supabase
          .from(table)
          .upsert(mapRow(reportKey, r), { onConflict: 'report_key' })
        if (error) throw error
        out.inserted++
      } catch (err) {
        out.errors.push(
          `${table} ${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `${table} list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncCampaigns(supabase: SupabaseClient): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listCampaigns({
      fieldmask:
        'report_key,campaign_key,name,status,locations,keywords,frequency,last_run,next_run,arp,atrp,solv,arp_move,atrp_move,solv_move,grid_size,radius,measurement',
    })
    const reports = lfCollection(listed, 'reports')
    out.checked = reports.length
    for (const summary of reports) {
      const s = asRecord(summary)
      const campaignKey = String(
        s.campaign_key || s.report_key || '',
      )
      if (!campaignKey) {
        out.skipped++
        continue
      }
      try {
        let detail: Record<string, unknown> = s
        try {
          detail = asRecord(
            await getCampaign(String(s.report_key || campaignKey)),
          )
          detail = asRecord(detail.report ?? detail)
        } catch {
          // list payload is enough if get fails
        }
        const { error } = await supabase.from('local_falcon_campaigns').upsert(
          {
            campaign_key: campaignKey,
            name: (detail.name as string) ?? (s.name as string) ?? null,
            status: (detail.status as string) ?? (s.status as string) ?? null,
            frequency:
              (detail.frequency as string) ?? (s.frequency as string) ?? null,
            keywords: detail.keywords ?? s.keywords ?? null,
            locations: detail.locations ?? s.locations ?? null,
            grid_size: lfInt(detail.grid_size ?? s.grid_size),
            radius: lfNum(detail.radius ?? s.radius),
            measurement:
              (detail.measurement as string) ??
              (s.measurement as string) ??
              null,
            last_run: (detail.last_run as string) ?? (s.last_run as string) ?? null,
            next_run: (detail.next_run as string) ?? (s.next_run as string) ?? null,
            arp: lfNum(detail.arp ?? s.arp),
            atrp: lfNum(detail.atrp ?? s.atrp),
            solv: lfNum(detail.solv ?? s.solv),
            arp_move: lfNum(s.arp_move),
            atrp_move: lfNum(s.atrp_move),
            solv_move: lfNum(s.solv_move),
            payload: { list: s, detail },
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'campaign_key' },
        )
        if (error) throw error
        out.inserted++
      } catch (err) {
        out.errors.push(
          `campaign ${campaignKey}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `campaign list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncGuard(supabase: SupabaseClient): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listGuardLocations()
    const locations = lfCollection(listed, 'locations').length
      ? lfCollection(listed, 'locations')
      : lfCollection(listed, 'reports')
    out.checked = locations.length
    for (const loc of locations) {
      const l = asRecord(loc)
      const placeId = String(l.place_id || '')
      if (!placeId) {
        out.skipped++
        continue
      }
      try {
        const { error } = await supabase.from('local_falcon_guard_locations').upsert(
          {
            place_id: placeId,
            status: (l.status as string) ?? null,
            location: l.location ?? l,
            date_added: (l.date_added as string) ?? null,
            date_last: (l.date_last as string) ?? null,
            payload: l,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'place_id' },
        )
        if (error) throw error
        try {
          const report = asRecord(await getGuardReport(placeId))
          await supabase.from('local_falcon_guard_reports').insert({
            place_id: placeId,
            payload: report,
          })
        } catch {
          // Guard detail may 404 when no report yet
        }
        out.inserted++
      } catch (err) {
        out.errors.push(
          `guard ${placeId}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `guard list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncReviews(supabase: SupabaseClient): Promise<SyncBucket> {
  const out = emptyBucket()
  try {
    const listed = await listReviewsReports({ limit: 25 })
    const reports = lfCollection(listed, 'reports')
    out.checked = reports.length
    for (const summary of reports) {
      const reportKey = String(summary.report_key || '')
      if (!reportKey) {
        out.skipped++
        continue
      }
      try {
        let payload: Record<string, unknown> = asRecord(summary)
        try {
          payload = asRecord(await getReviewsReport(reportKey))
          payload = asRecord(payload.report ?? payload)
        } catch {
          // list row is enough
        }
        const { error } = await supabase.from('local_falcon_reviews_reports').upsert(
          {
            report_key: reportKey,
            reviews_key: (payload.reviews_key as string) ?? null,
            place_id: (payload.place_id as string) ?? null,
            name: (payload.name as string) ?? null,
            payload,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'report_key' },
        )
        if (error) throw error
        out.inserted++
      } catch (err) {
        out.errors.push(
          `reviews ${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  } catch (err) {
    out.errors.push(
      `reviews list: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return out
}

async function syncAccount(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const account = await getAccount()
    const { error } = await supabase.from('local_falcon_account_snapshot').upsert({
      id: 1,
      credits: account.credits ?? null,
      email: (account.email as string) ?? null,
      package: account.meta ?? null,
      payload: account,
      synced_at: new Date().toISOString(),
    })
    if (error) throw error
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Sync every Falcon product surface we cache. Reads are free. */
export async function syncAllLocalFalcon(
  supabase: SupabaseClient,
  options?: { limit?: number; upgradeExisting?: boolean },
): Promise<FullSyncResult> {
  const scans = await syncLocalFalconScans(supabase, options)
  const competitors = await syncCompetitorReports(supabase, options?.limit ?? 25)
  const trends = await syncTrendReports(supabase, options?.limit ?? 25)
  const locations = await syncSimpleKeyReports(
    supabase,
    'local_falcon_location_reports',
    () => listLocationReports(),
    (key) => getLocationReport(key),
    (key, r) => ({
      report_key: key,
      place_id: (r.place_id as string) ?? null,
      payload: r,
      synced_at: new Date().toISOString(),
    }),
  )
  const keywords = await syncSimpleKeyReports(
    supabase,
    'local_falcon_keyword_reports',
    () => listKeywordReports({ limit: 25 }),
    (key) => getKeywordReport(key),
    (key, r) => ({
      report_key: key,
      keyword: (r.keyword as string) ?? null,
      payload: r,
      synced_at: new Date().toISOString(),
    }),
  )
  const campaigns = await syncCampaigns(supabase)
  const guard = await syncGuard(supabase)
  const reviews = await syncReviews(supabase)
  const account = await syncAccount(supabase)

  return {
    scans,
    competitors,
    trends,
    locations,
    keywords,
    campaigns,
    guard,
    reviews,
    account,
  }
}
