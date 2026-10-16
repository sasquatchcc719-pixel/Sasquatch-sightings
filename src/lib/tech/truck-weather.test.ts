import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTruckWeather, overnightTruckWeather } from './truck-weather'

const now = new Date('2026-10-16T23:00:00Z')
const updated = '2026-10-16T22:00:00Z'
const period = {
  startTime: '2026-10-16T18:00:00-06:00',
  endTime: '2026-10-17T06:00:00-06:00',
  isDaytime: false,
  temperature: 33,
  temperatureUnit: 'F',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('overnight truck weather', () => {
  it.each([
    [32, true],
    [33, true],
    [34, false],
    [60, false],
  ])('warns at %s°F: %s', (temperature, cold) => {
    expect(
      overnightTruckWeather([{ ...period, temperature }], updated, now),
    ).toMatchObject({ lowF: temperature, cold })
  })

  it('uses the next nighttime minimum rather than a daytime temperature', () => {
    expect(
      overnightTruckWeather(
        [
          { ...period, isDaytime: true, temperature: 55 },
          period,
          {
            ...period,
            startTime: '2026-10-17T18:00:00-06:00',
            temperature: 20,
          },
        ],
        updated,
        now,
      ).lowF,
    ).toBe(33)
  })

  it('keeps the current overnight period after midnight Mountain Time', () => {
    expect(
      overnightTruckWeather([period], updated, new Date('2026-10-17T07:00:00Z'))
        .lowF,
    ).toBe(33)
  })

  it('skips an expired night and selects the upcoming night', () => {
    const nextNight = {
      ...period,
      startTime: '2026-10-17T18:00:00-06:00',
      endTime: '2026-10-18T06:00:00-06:00',
      temperature: 40,
    }
    expect(
      overnightTruckWeather(
        [period, nextNight],
        '2026-10-17T12:00:00Z',
        new Date('2026-10-17T15:00:00Z'),
      ).lowF,
    ).toBe(40)
  })

  it('converts Celsius before checking the threshold', () => {
    expect(
      overnightTruckWeather(
        [{ ...period, temperature: 0, temperatureUnit: 'C' }],
        updated,
        now,
      ),
    ).toMatchObject({ lowF: 32, cold: true })
  })

  it('reports unavailable for stale, missing, or invalid forecasts', () => {
    expect(
      overnightTruckWeather([period], '2026-10-15T22:00:00Z', now).lowF,
    ).toBeNull()
    expect(overnightTruckWeather([], updated, now).lowF).toBeNull()
    expect(
      overnightTruckWeather(
        [{ ...period, temperature: null as unknown as number }],
        updated,
        now,
      ).lowF,
    ).toBeNull()
    expect(
      overnightTruckWeather([{ ...period, temperatureUnit: 'K' }], updated, now)
        .lowF,
    ).toBeNull()
  })

  it('fetches Palmer Lake and follows the NWS forecast link', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            properties: {
              forecast: 'https://api.weather.gov/gridpoints/PUB/1,2/forecast',
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            properties: { periods: [period], updateTime: updated },
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    expect(await getTruckWeather()).toMatchObject({ lowF: 33, cold: true })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.weather.gov/points/39.1214,-104.9119',
    )
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.weather.gov/gridpoints/PUB/1,2/forecast?units=us',
    )
  })

  it('falls back when the provider is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await getTruckWeather()).toEqual({
      lowF: null,
      cold: false,
      forecastUpdatedAt: null,
    })
  })

  it('does not follow a forecast link to another host', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          properties: { forecast: 'https://example.com/forecast' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect((await getTruckWeather()).lowF).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
