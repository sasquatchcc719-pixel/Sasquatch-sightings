/**
 * Settings-driven scan scheduling for both rank scanners.
 *
 * One daily cron calls `runDueScans`. Each row in scan_schedules says how
 * often its tool should run; anything due gets fired, and last_run_at moves
 * forward. Changing frequency is a settings edit, not a deploy — the reason
 * this exists is that the grid cron was hardcoded monthly in vercel.json and
 * Charles wanted weekly with a knob he could turn himself.
 *
 * Both scanners are triggered from OUR side so one page controls cadence:
 * - dataforseo_grid: runs our own grid scanner (pay-as-you-go, ~$0.002/point)
 * - local_falcon:    fires a scan via their API (grid_size^2 credits from the
 *   7,500/month Starter allowance; a weekly 13x13 uses ~727/month). Results
 *   flow back through the existing local-falcon-sync cron, so this only
 *   triggers — it never ingests.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { runGridScan } from '@/lib/radar-grid'
import { runScan, scanCost } from '@/lib/local-falcon'

export type ScanSchedule = {
  id: string
  tool: string
  enabled: boolean
  frequency_days: number
  config: Record<string, unknown>
  last_run_at: string | null
  last_result: string | null
}

export function isDue(s: Pick<ScanSchedule, 'enabled' | 'frequency_days' | 'last_run_at'>, now = new Date()): boolean {
  if (!s.enabled) return false
  if (!s.last_run_at) return true
  const next = new Date(s.last_run_at).getTime() + s.frequency_days * 86_400_000
  return now.getTime() >= next
}

export type SchedulerResult = {
  checked: number
  fired: string[]
  skipped: string[]
  errors: Record<string, string>
}

export async function runDueScans(supabase: SupabaseClient): Promise<SchedulerResult> {
  const out: SchedulerResult = { checked: 0, fired: [], skipped: [], errors: {} }

  const { data: schedules, error } = await supabase
    .from('scan_schedules')
    .select('*')
  if (error) throw error

  for (const s of (schedules ?? []) as ScanSchedule[]) {
    out.checked++
    if (!isDue(s)) {
      out.skipped.push(s.tool)
      continue
    }

    let result = ''
    try {
      if (s.tool === 'dataforseo_grid') {
        const preset = String(s.config.preset ?? 'service-area') as
          | 'service-area'
          | 'tri-lakes'
        const spacing = Number(s.config.spacing_miles ?? 2)
        const buffer = Number(s.config.buffer_miles ?? 0)
        const centerLat = Number(s.config.lat)
        const centerLng = Number(s.config.lng)
        const gridSize = Number(s.config.grid_size)
        const scan = await runGridScan(supabase, {
          preset,
          spacingMiles: spacing,
          keyword: String(s.config.keyword ?? 'carpet cleaning'),
          bufferMiles: Number.isFinite(buffer) ? buffer : 0,
          ...(Number.isFinite(centerLat) ? { centerLat } : {}),
          ...(Number.isFinite(centerLng) ? { centerLng } : {}),
          ...(Number.isFinite(gridSize) && gridSize >= 3
            ? { gridSize }
            : {}),
        })
        result = `scan ${scan.scanId ?? '?'}: ${scan.pointsScanned ?? '?'} points`
      } else if (s.tool === 'local_falcon') {
        const gridSize = Number(s.config.grid_size ?? 13)
        // lat/lng are required even when place_id is supplied — verified
        // against the live API, which returns 400 "You must specify a
        // latitude." without them.
        const lat = Number(s.config.lat)
        const lng = Number(s.config.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error('config.lat / config.lng are required for local_falcon')
        }
        const scan = await runScan({
          place_id: String(s.config.place_id ?? ''),
          keyword: String(s.config.keyword ?? 'carpet cleaning'),
          grid_size: gridSize,
          radius: Number(s.config.radius ?? 14),
          measurement: String(s.config.measurement ?? 'mi'),
          platform: String(s.config.platform ?? 'google'),
          lat,
          lng,
        })
        // Their API returns a report key on success; the sync cron will pull
        // the full point data within 6 hours.
        const key =
          (scan as { report_key?: string }).report_key ??
          (scan as { report?: { report_key?: string } }).report?.report_key ??
          'triggered'
        result = `report ${key} (${scanCost(gridSize)} credits)`
      } else {
        out.errors[s.tool] = `unknown tool`
        continue
      }

      out.fired.push(s.tool)
      await supabase
        .from('scan_schedules')
        .update({
          last_run_at: new Date().toISOString(),
          last_result: result.slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq('id', s.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      out.errors[s.tool] = msg
      // Record the failure but do NOT advance last_run_at — a failed scan
      // should retry tomorrow, not silently wait a full cycle.
      await supabase
        .from('scan_schedules')
        .update({
          last_result: `ERROR: ${msg.slice(0, 280)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', s.id)
    }
  }

  return out
}
