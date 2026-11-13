import { z } from 'zod'
import { trackerStatus } from '@/lib/fleet-tracking'
import { readDavidCanvassStatus } from '@/lib/gps/david-canvass-status'
import { getTruckWeather } from '@/lib/tech/truck-weather'
import {
  BOX_TRUCK_NAME,
  PROBE_STALE_MS,
  temperatureAlarm,
} from '@/lib/truck-temperature'
import type { createAdminClient } from '@/supabase/server'

const days = z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)])
const reading = z.object({ temperature_f: z.number(), at: z.string() })

export const boxTruckStatusInput = z
  .object({
    history_days: days
      .optional()
      .describe(
        'Include the recorded low and high for the last 1, 7, 30, or 90 days. Omit for current status only.',
      ),
  })
  .strict()

export const boxTruckStatusOutput = z.object({
  vehicle: z.string(),
  checked_at: z.string(),
  timezone: z.literal('America/Denver'),
  travel: z
    .object({
      status: z.string(),
      last_seen_at: z.string().nullable(),
      gps_at: z.string().nullable(),
    })
    .nullable(),
  hanging_door_flyers: z.boolean().nullable(),
  probe: z
    .object({
      temperature_f: z.number().nullable(),
      received_at: z.string().nullable(),
      fresh: z.boolean(),
      low_limit_f: z.number().nullable(),
      high_limit_f: z.number().nullable(),
      alarm: z.enum(['low', 'high']).nullable(),
    })
    .nullable(),
  history: z
    .object({
      days,
      first_bucket_at: z.string().nullable(),
      last_bucket_at: z.string().nullable(),
      low: reading.nullable(),
      high: reading.nullable(),
    })
    .nullable(),
  spread_history: z
    .object({
      days,
      intervals: z.number(),
      low_f: z.number().nullable(),
      high_f: z.number().nullable(),
    })
    .nullable(),
  palmer_lake_current_f: z.number().nullable(),
  outdoor_observed_at: z.string().nullable(),
  outdoor_station: z.string().nullable(),
  truck_minus_outdoor_f: z.number().nullable(),
  palmer_lake_overnight_low_f: z.number().nullable(),
  forecast_updated_at: z.string().nullable(),
  unavailable: z.array(z.string()),
})

function round(value: number) {
  return Math.round(value * 10) / 10
}

export async function readBoxTruckStatus(
  db: ReturnType<typeof createAdminClient>,
  historyDays?: z.infer<typeof days>,
) {
  const [trackerResult, hangingDoors, forecast] = await Promise.all([
    db
      .from('fleet_trackers')
      .select(
        'id,enabled,last_seen_at,gps_fix,gps_at,speed_mps,probe_temperature_c,probe_received_at,temperature_low_f,temperature_high_f',
      )
      .eq('name', BOX_TRUCK_NAME)
      .maybeSingle(),
    readDavidCanvassStatus(db),
    getTruckWeather(),
  ])
  const tracker = trackerResult.data
  const [historyResult, spreadResult] =
    tracker && historyDays
      ? await Promise.all([
          db.rpc('fleet_temperature_history_summary', {
            p_tracker_id: tracker.id,
            p_days: historyDays,
          }),
          db.rpc('fleet_temperature_spread', {
            p_tracker_id: tracker.id,
            p_days: historyDays,
          }),
        ])
      : [null, null]
  const now = Date.now()
  const temperatureF =
    tracker?.probe_temperature_c == null
      ? null
      : tracker.probe_temperature_c * 1.8 + 32
  const fresh = !!(
    tracker?.probe_received_at &&
    temperatureF != null &&
    now - Date.parse(tracker.probe_received_at) <= PROBE_STALE_MS
  )
  const unavailable: string[] = []
  if (!tracker) unavailable.push('truck telemetry and alarm settings')
  if (hangingDoors == null) unavailable.push('door-hanging activity')
  if (forecast.currentF == null)
    unavailable.push('Palmer Lake outdoor observation')
  if (forecast.lowF == null) unavailable.push('Palmer Lake forecast')
  if (historyDays && (!historyResult || historyResult.error))
    unavailable.push('temperature history')

  let history: z.infer<typeof boxTruckStatusOutput>['history'] = null
  if (historyDays && historyResult && !historyResult.error) {
    const rows: { minute_at: string; low_f: number; high_f: number }[] =
      historyResult.data ?? []
    let low: (typeof rows)[number] | undefined
    let high: (typeof rows)[number] | undefined
    for (const row of rows) {
      if (!low || row.low_f < low.low_f) low = row
      if (!high || row.high_f > high.high_f) high = row
    }
    history = {
      days: historyDays,
      first_bucket_at: rows[0]?.minute_at ?? null,
      last_bucket_at: rows.at(-1)?.minute_at ?? null,
      low: low ? { temperature_f: round(low.low_f), at: low.minute_at } : null,
      high: high
        ? { temperature_f: round(high.high_f), at: high.minute_at }
        : null,
    }
  }

  const spreads: number[] = (spreadResult?.data ?? []).map(
    (row: { spread_f: number }) => row.spread_f,
  )
  if (historyDays && (!spreadResult || spreadResult.error))
    unavailable.push('outdoor spread history')

  return {
    vehicle: BOX_TRUCK_NAME,
    checked_at: new Date(now).toISOString(),
    timezone: 'America/Denver',
    travel: tracker
      ? {
          status: trackerStatus(tracker, now),
          last_seen_at: tracker.last_seen_at,
          gps_at: tracker.gps_at,
        }
      : null,
    hanging_door_flyers: hangingDoors,
    probe: tracker
      ? {
          temperature_f: temperatureF == null ? null : round(temperatureF),
          received_at: tracker.probe_received_at,
          fresh,
          low_limit_f: tracker.temperature_low_f,
          high_limit_f: tracker.temperature_high_f,
          alarm: fresh
            ? temperatureAlarm(
                temperatureF,
                tracker.temperature_low_f,
                tracker.temperature_high_f,
              )
            : null,
        }
      : null,
    history,
    spread_history:
      historyDays && spreadResult && !spreadResult.error
        ? {
            days: historyDays,
            intervals: spreads.length,
            low_f: spreads.length ? round(Math.min(...spreads)) : null,
            high_f: spreads.length ? round(Math.max(...spreads)) : null,
          }
        : null,
    palmer_lake_current_f:
      forecast.currentF == null ? null : round(forecast.currentF),
    outdoor_observed_at: forecast.observedAt,
    outdoor_station: forecast.stationName,
    truck_minus_outdoor_f:
      fresh && temperatureF != null && forecast.currentF != null
        ? round(temperatureF - forecast.currentF)
        : null,
    palmer_lake_overnight_low_f: forecast.lowF,
    forecast_updated_at: forecast.forecastUpdatedAt,
    unavailable,
  } satisfies z.infer<typeof boxTruckStatusOutput>
}
