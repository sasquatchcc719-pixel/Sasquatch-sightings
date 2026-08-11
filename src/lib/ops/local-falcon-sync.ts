/**
 * Pull Local Falcon scan reports into our own tables.
 *
 * Local Falcon returns everything as strings (their API is PHP-flavoured), so
 * every numeric field goes through a coercion that turns '' and 'null' into
 * null rather than 0 — a rank of 0 would read as "first place" on a heat map.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listReports, getReport } from '@/lib/local-falcon'

/** '' | 'null' | undefined -> null. Everything else -> Number, or null if NaN. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s || s.toLowerCase() === 'null') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function int(value: unknown): number | null {
  const n = num(value)
  return n === null ? null : Math.round(n)
}

export type SyncResult = {
  checked: number
  inserted: number
  skipped: number
  errors: string[]
}

type RawPoint = {
  lat?: string | number
  lng?: string | number
  found?: boolean
  rank?: number | string | null
  results?: Array<Record<string, unknown>>
}

/**
 * Trim a point's competitor list before storing.
 *
 * The API returns up to 20 places per point with full category maps — roughly
 * 1MB per scan if stored verbatim. The top 5 answers every question we
 * actually ask ("who is beating us here"), so the rest is dropped.
 */
function trimCompetitors(results: RawPoint['results']): unknown[] {
  if (!Array.isArray(results)) return []
  return results.slice(0, 5).map((r) => ({
    rank: int(r.rank),
    place_id: r.place_id ?? null,
    name: r.name ?? null,
    rating: num(r.rating),
    reviews: int(r.reviews),
    address: r.address ?? null,
  }))
}

/**
 * Mirror any scans we haven't stored yet.
 *
 * Idempotent: report_key is unique, so re-running is safe and cheap. Reading
 * reports costs no Local Falcon credits — only running a scan does.
 */
export async function syncLocalFalconScans(
  supabase: SupabaseClient,
  options?: { limit?: number },
): Promise<SyncResult> {
  const out: SyncResult = { checked: 0, inserted: 0, skipped: 0, errors: [] }

  const listed = (await listReports({ limit: options?.limit ?? 25 })) as
    | { reports?: Array<Record<string, unknown>> }
    | Array<Record<string, unknown>>
  const reports = Array.isArray(listed) ? listed : (listed.reports ?? [])
  out.checked = reports.length
  if (!reports.length) return out

  const keys = reports.map((r) => String(r.report_key)).filter(Boolean)
  const { data: existing } = await supabase
    .from('local_falcon_scans')
    .select('report_key')
    .in('report_key', keys)
  const have = new Set((existing ?? []).map((r) => r.report_key as string))

  for (const summary of reports) {
    const reportKey = String(summary.report_key || '')
    if (!reportKey || have.has(reportKey)) {
      out.skipped++
      continue
    }

    try {
      const raw = (await getReport(reportKey)) as Record<string, any>
      const r = raw.report ?? raw

      // `timestamp` is unix seconds as a string; `date` is display-formatted
      // in the account's timezone and is not safe to parse.
      const ts = int(r.timestamp)
      const scannedAt = ts
        ? new Date(ts * 1000).toISOString()
        : new Date().toISOString()

      const { data: scan, error: scanError } = await supabase
        .from('local_falcon_scans')
        .insert({
          report_key: reportKey,
          place_id: r.place_id ?? null,
          keyword: String(r.keyword ?? ''),
          platform: String(r.platform ?? 'google'),
          scanned_at: scannedAt,
          grid_size: int(r.grid_size),
          radius: num(r.radius),
          measurement: r.measurement ?? null,
          center_lat: num(r.lat),
          center_lng: num(r.lng),
          arp: num(r.arp),
          atrp: num(r.atrp),
          solv: num(r.solv),
          found_in: int(r.found_in),
          points_total: int(r.points),
          unique_competitors: int(r.unique_competitors),
          public_url: r.public_url ?? null,
          insights: r.insights ?? null,
        })
        .select('id')
        .single()
      if (scanError) throw scanError

      const points = (r.data_points ?? []) as RawPoint[]
      if (points.length) {
        const rows = points.map((p, idx) => ({
          scan_id: scan.id,
          idx,
          lat: num(p.lat) ?? 0,
          lng: num(p.lng) ?? 0,
          found: Boolean(p.found),
          // Only a real placement gets a rank. `found: false` means we were
          // nowhere in the top 20 here, which is not rank 0.
          rank: p.found ? int(p.rank) : null,
          competitors: trimCompetitors(p.results),
        }))
        const { error: pointError } = await supabase
          .from('local_falcon_points')
          .insert(rows)
        if (pointError) throw pointError
      }

      out.inserted++
    } catch (err) {
      out.errors.push(
        `${reportKey}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return out
}
