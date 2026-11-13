import { PUBLIC_AREAS } from '@/lib/public-areas'

export const TRUCK_COLD_THRESHOLD_F = 33

type OutdoorTemperature = {
  currentF: number | null
  observedAt: string | null
  stationName: string | null
}

export type TruckWeather = OutdoorTemperature & {
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
): Omit<TruckWeather, keyof OutdoorTemperature> {
  const unavailable: ReturnType<typeof overnightTruckWeather> = {
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

  const noObservation: OutdoorTemperature = {
    currentF: null,
    observedAt: null,
    stationName: null,
  }
  const noForecast = { lowF: null, cold: false, forecastUpdatedAt: null }
  const origin = 'https://api.weather.gov'

  async function readForecast(link: string) {
    const url = new URL(link)
    if (
      url.origin !== origin ||
      !/^\/gridpoints\/[A-Z]+\/\d+,\d+\/forecast$/.test(url.pathname)
    )
      throw new Error('Unexpected NWS forecast URL')
    url.searchParams.set('units', 'us')
    const forecast = await getJson(url.toString())
    return overnightTruckWeather(
      forecast.properties.periods,
      forecast.properties.updateTime,
    )
  }

  async function readObservation(link?: string): Promise<OutdoorTemperature> {
    if (!link) return noObservation
    const url = new URL(link)
    if (
      url.origin !== origin ||
      !/^\/gridpoints\/[A-Z]+\/\d+,\d+\/stations$/.test(url.pathname)
    )
      throw new Error('Unexpected NWS stations URL')
    const stations = await getJson(url.toString())
    const candidates = await Promise.all(
      (stations.features ?? [])
        .slice(0, 4)
        .map(
          async (feature: {
            properties?: { stationIdentifier?: string; name?: string }
          }): Promise<OutdoorTemperature | null> => {
            const id = feature.properties?.stationIdentifier
            if (!id || !/^[A-Z0-9]+$/.test(id)) return null
            const observation = await getJson(
              `${origin}/stations/${id}/observations/latest`,
            ).catch(() => null)
            const { timestamp, temperature } = observation?.properties ?? {}
            const age = Date.now() - Date.parse(timestamp)
            if (
              !(age >= 0 && age <= 90 * 60_000) ||
              typeof temperature?.value !== 'number' ||
              !Number.isFinite(temperature.value)
            )
              return null
            const value =
              temperature.unitCode === 'wmoUnit:degC'
                ? temperature.value * 1.8 + 32
                : temperature.unitCode === 'wmoUnit:degF'
                  ? temperature.value
                  : null
            return value == null
              ? null
              : {
                  currentF: value,
                  observedAt: timestamp,
                  stationName: feature.properties?.name ?? id,
                }
          },
        ),
    )
    return candidates.find((candidate) => candidate != null) ?? noObservation
  }

  try {
    const { lat, lng } = PUBLIC_AREAS['palmer-lake']
    const point = await getJson(`${origin}/points/${lat},${lng}`)
    const [forecast, observation] = await Promise.allSettled([
      readForecast(point.properties.forecast),
      readObservation(point.properties.observationStations),
    ])
    if (forecast.status === 'rejected')
      console.error('[truck-weather] Forecast unavailable:', forecast.reason)
    if (observation.status === 'rejected')
      console.error(
        '[truck-weather] Observation unavailable:',
        observation.reason,
      )
    return {
      ...(forecast.status === 'fulfilled' ? forecast.value : noForecast),
      ...(observation.status === 'fulfilled'
        ? observation.value
        : noObservation),
    }
  } catch (error) {
    console.error('[truck-weather] Location unavailable:', error)
    return { ...noForecast, ...noObservation }
  }
}
