import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPlannedDriving, plannedJobPairs } from './planned-driving'
import type { DispatchJob } from './daily-dispatch'

const job = (
  id: string,
  start: string,
  staffId: string | null = 'david',
  location = true,
): DispatchJob => ({
  id,
  date: '2026-10-20',
  start,
  end: '12:00:00',
  staffId,
  staffName: staffId ?? 'Unassigned',
  status: 'booked',
  name: id,
  address: 'Address',
  href: `/jobs/${id}`,
  location: location
    ? { lat: 39.1, lng: -104.8, source: 'Verified address' }
    : null,
})
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
  vi.stubEnv('MAPBOX_TOKEN', '')
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('planned driving', () => {
  it('orders morning to evening within each technician, without crossing technicians or inventing an unassigned route', () => {
    const pairs = plannedJobPairs([
      job('evening', '17:00'),
      job('other', '11:00', 'charles'),
      job('morning', '09:00'),
      job('middle', '14:00'),
      job('unassigned', '10:00', null),
    ])
    expect(pairs.map((pair) => pair.map((stop) => stop.id))).toEqual([
      ['morning', 'middle'],
      ['middle', 'evening'],
    ])
  })
  it('keeps an unmapped stop in sequence and does not draw a route over it', async () => {
    const legs = await loadPlannedDriving([
      job('one', '09:00'),
      job('missing', '12:00', 'david', false),
      job('three', '17:00'),
    ])
    expect(
      legs.map((leg) => [leg.fromJobId, leg.toJobId, leg.seconds]),
    ).toEqual([
      ['one', 'missing', null],
      ['missing', 'three', null],
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('uses road geometry and provider duration, with reusable cached requests independent of GPS polling', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            duration: 742,
            distance: 8500,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-104.8, 39.1],
                [-104.9, 39.2],
              ],
            },
          },
        ],
      }),
    })
    const legs = await loadPlannedDriving([
      job('one', '09:00'),
      job('two', '12:00'),
    ])
    expect(legs[0]).toMatchObject({
      seconds: 742,
      meters: 8500,
      error: null,
      coordinates: [
        [-104.8, 39.1],
        [-104.9, 39.2],
      ],
    })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url.pathname).toContain('/directions/v5/mapbox/driving/')
    expect(url.searchParams.get('geometries')).toBe('geojson')
    expect(options.next.revalidate).toBe(86400)
  })
  it('preserves successful legs when another pair cannot be routed', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            duration: 0,
            distance: 0,
            geometry: {
              type: 'LineString',
              coordinates: [
                [-104.8, 39.1],
                [-104.8, 39.1],
              ],
            },
          },
        ],
      }),
    })
    const legs = await loadPlannedDriving([
      job('one', '09:00'),
      job('two', '12:00'),
      job('three', '17:00'),
    ])
    expect(legs[0]).toMatchObject({
      seconds: null,
      coordinates: [],
      error: 'Driving estimate unavailable',
    })
    expect(legs[1]).toMatchObject({ seconds: 0, meters: 0, error: null })
  })
  it('rejects malformed provider data rather than displaying a fabricated estimate', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            duration: 100,
            distance: 100,
            geometry: { type: 'LineString', coordinates: [] },
          },
        ],
      }),
    })
    expect(
      (await loadPlannedDriving([job('one', '09:00'), job('two', '12:00')]))[0]
        .seconds,
    ).toBeNull()
  })
})
