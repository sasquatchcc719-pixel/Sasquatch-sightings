export const BOX_TRUCK_NAME = "David's Box Truck"
export const PROBE_STALE_MS = 5 * 60_000

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
