export const BOX_TRUCK_NAME = "David's Box Truck"
export const PROBE_STALE_MS = 5 * 60_000

export const TEMPERATURE_HISTORY_RANGES = [
  { days: 1, label: '24 hours', bucketMinutes: 2, interval: '2-minute' },
  { days: 7, label: '7 days', bucketMinutes: 15, interval: '15-minute' },
  { days: 30, label: '30 days', bucketMinutes: 60, interval: 'Hourly' },
  { days: 90, label: '90 days', bucketMinutes: 180, interval: '3-hour' },
] as const

export type TruckTemperature = {
  temperatureF: number | null
  receivedAt: string | null
  lowF: number | null
  highF: number | null
}

export function temperatureAlarm(
  temperatureF: number | null,
  lowF: number | null,
  highF: number | null,
): 'low' | 'high' | null {
  if (temperatureF == null) return null
  if (lowF != null && temperatureF <= lowF) return 'low'
  if (highF != null && temperatureF >= highF) return 'high'
  return null
}
