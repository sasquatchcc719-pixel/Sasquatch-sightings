import { expect, it } from 'vitest'
import {
  dispatchDayBounds,
  dispatchLocation,
  driveIntervals,
  isDispatchDay,
} from './daily-dispatch'
import { PUBLIC_AREAS } from '@/lib/public-areas'
const point = (time: string, speed: number | null) => ({
  recorded_at: `2026-10-19T${time}Z`,
  latitude: 39.15,
  longitude: -104.87,
  speed_mps: speed,
  bearing: 0,
})
it('validates real calendar dates and uses Mountain Time DST boundaries', () => {
  expect(isDispatchDay('2026-02-30')).toBe(false)
  expect(isDispatchDay('bad')).toBe(false)
  const bounds = dispatchDayBounds('2026-11-01')!
  expect(Date.parse(bounds.end) - Date.parse(bounds.start)).toBe(25 * 3600000)
  expect(dispatchDayBounds('2026-02-30')).toBeNull()
})
it('requires verified street coordinates or captured on-site GPS, never raw geocodes or area centers', () => {
  const a = {
    latitude: 39.15,
    longitude: -104.87,
    geocoded_at: '2026-10-19',
    geocode_source: 'nominatim',
  }
  expect(dispatchLocation(a, null, null)).toBeNull()
  expect(
    dispatchLocation(
      { ...a, geocode_source: 'nominatim-street-verified' },
      null,
      null,
    )?.source,
  ).toBe('Verified address')
  for (const source of [
    'colorado-state-address-point',
    'nominatim-street-verified-backfill',
  ]) {
    expect(
      dispatchLocation({ ...a, geocode_source: source }, null, null)?.source,
    ).toBe('Verified address')
  }
  expect(dispatchLocation(a, 39.16, -104.88)?.source).toBe('On-site GPS')
  expect(dispatchLocation(null, 91, -104)).toBeNull()
  expect(
    dispatchLocation(
      null,
      PUBLIC_AREAS.monument.lat,
      PUBLIC_AREAS.monument.lng,
    ),
  ).toBeNull()
})
it('splits observed driving at signal gaps and sustained stops without inventing arrivals', () => {
  const drives = driveIntervals([
    point('14:00:00', 4),
    point('14:00:30', 4),
    point('14:01:00', 0),
    point('14:03:00', 0),
    point('14:04:00', 5),
    point('14:04:30', 5),
    point('14:10:00', 6),
    point('14:10:30', 6),
  ])
  expect(
    drives.map((d) => [d.start.slice(11, 19), d.end.slice(11, 19)]),
  ).toEqual([
    ['14:00:00', '14:00:30'],
    ['14:04:00', '14:04:30'],
    ['14:10:00', '14:10:30'],
  ])
  expect(
    driveIntervals([point('14:00:00', 0), point('14:01:00', null)]),
  ).toEqual([])
})
