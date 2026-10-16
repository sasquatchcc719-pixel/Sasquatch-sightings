import { PUBLIC_AREAS } from '@/lib/public-areas'

export const TRUCK_COLD_THRESHOLD_F = 33

export type TruckWeather = {
  lowF: number | null
  cold: boolean
  forecastUpdatedAt: string | null
}

type ForecastPeriod = {
  startTime: string
  endTime: string
  isDaytime: boolean
  temperature: number
  temperatureUnit: string
}

export function overnightTruckWeather(
  periods: ForecastPeriod[],
  updatedAt: string,
  now = new Date(),
): TruckWeather {
  const unavailable: TruckWeather = {
    lowF: null,
    cold: false,
    forecastUpdatedAt: null,
  }
  const age = now.getTime() - new Date(updatedAt).getTime()
  if (!Number.isFinite(age) || age < 0 || age > 12 * 60 * 60_000) {
    return unavailable
  }

  // NWS nighttime periods contain the overnight minimum. After midnight,
  // retain the current night until it ends rather than skipping to tomorrow.
  const night = periods
    .filter(
      (period) =>
        period.isDaytime === false &&
        new Date(period.endTime).getTime() > now.getTime() &&
        new Date(period.startTime).getTime() < now.getTime() + 24 * 60 * 60_000,
    )
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0]
  if (
    !night ||
    typeof night.temperature !== 'number' ||
    !Number.isFinite(night.temperature) ||
    !['F', 'C'].includes(night.temperatureUnit)
  ) {
    return unavailable
  }
  const lowF =
    night.temperatureUnit === 'C'
      ? (night.temperature * 9) / 5 + 32
      : night.temperature
  return {
    lowF,
    cold: lowF <= TRUCK_COLD_THRESHOLD_F,
    forecastUpdatedAt: updatedAt,
  }
}

export async function getTruckWeather(): Promise<TruckWeather> {
  async function getJson(url: string) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SasquatchSightings-TruckWeather',
        Accept: 'application/geo+json',
      },
      next: { revalidate: 900 },
      signal: AbortSignal.timeout(3_500),
    })
    if (!response.ok) throw new Error(`NWS forecast failed: ${response.status}`)
    return response.json()
  }

  try {
    const { lat, lng } = PUBLIC_AREAS['palmer-lake']
    const point = await getJson(`https://api.weather.gov/points/${lat},${lng}`)
    const forecastUrl = new URL(point.properties.forecast)
    if (
      forecastUrl.origin !== 'https://api.weather.gov' ||
      !/^\/gridpoints\/[A-Z]+\/\d+,\d+\/forecast$/.test(forecastUrl.pathname)
    ) {
      throw new Error('Unexpected NWS forecast URL')
    }
    forecastUrl.searchParams.set('units', 'us')
    const forecast = await getJson(forecastUrl.toString())
    return overnightTruckWeather(
      forecast.properties.periods,
      forecast.properties.updateTime,
    )
  } catch (error) {
    console.error('[truck-weather] Forecast unavailable:', error)
    return { lowF: null, cold: false, forecastUpdatedAt: null }
  }
}
