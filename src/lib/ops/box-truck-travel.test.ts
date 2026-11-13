// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FleetTracker } from '@/lib/fleet-tracking'
import { readBoxTruckTravelProgress } from './box-truck-travel'

const now = new Date('2026-11-13T16:00:00Z').getTime()
const startedAt = '2026-11-13T15:30:00.000Z'
const tracker: FleetTracker = {
  id: 'tracker-1',
  name: "David's Box Truck",
  enabled: true,
  firmware: null,
  battery_v: null,
  gps_fix: true,
  last_seen_at: '2026-11-13T15:59:55.000Z',
  gps_at: '2026-11-13T15:59:55.000Z',
  latitude: 38.9,
  longitude: -104.7,
  speed_mps: 12,
  bearing: null,
  satellites: 8,
}

function query(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit'])
    chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

beforeEach(() => {
  vi.stubEnv('MAPBOX_TOKEN', 'test-token')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL) =>
      Response.json({
        code: 'Ok',
        routes: [
          input.pathname.includes('driving-traffic')
            ? { duration: 600, distance: 1609.344 }
            : { duration: 2400, distance: 8046.72 },
        ],
      }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('returns live ETA, remaining distance and route progress for David’s active trip', async () => {
  const activeLink = query({
    data: {
      appointment_id: 'appointment-1',
      tracker_id: tracker.id,
      started_at: startedAt,
      destination_lat: 38.95,
      destination_lng: -104.65,
      closed_reason: null,
    },
  })
  const appointment = query({
    data: {
      status: 'on_my_way',
      on_my_way_at: startedAt,
      ops_customers: { full_name: 'Jineane Bazzle', business_name: null },
    },
  })
  const origin = query({ data: { latitude: 38.8, longitude: -104.8 } })
  const recheck = query({ data: { closed_reason: null } })
  let linkReads = 0
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'customer_arrival_links')
        return linkReads++ === 0 ? activeLink : recheck
      if (table === 'ops_appointments') return appointment
      return origin
    }),
  }

  await expect(
    readBoxTruckTravelProgress(db as never, tracker, now),
  ).resolves.toEqual({
    appointmentId: 'appointment-1',
    destinationName: 'Jineane Bazzle',
    eta: '2026-11-13T16:10:00.000Z',
    minutesRemaining: 10,
    milesRemaining: 1,
    progressPercent: 80,
  })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('does not show a trip after it closes during the routing lookup', async () => {
  const activeLink = query({
    data: {
      appointment_id: 'appointment-1',
      tracker_id: tracker.id,
      started_at: startedAt,
      destination_lat: 38.95,
      destination_lng: -104.65,
      closed_reason: null,
    },
  })
  const appointment = query({
    data: {
      status: 'on_my_way',
      on_my_way_at: startedAt,
      ops_customers: { full_name: 'Customer', business_name: null },
    },
  })
  const origin = query({ data: { latitude: 38.8, longitude: -104.8 } })
  const recheck = query({ data: { closed_reason: 'arrived' } })
  let linkReads = 0
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'customer_arrival_links')
        return linkReads++ === 0 ? activeLink : recheck
      if (table === 'ops_appointments') return appointment
      return origin
    }),
  }

  await expect(
    readBoxTruckTravelProgress(db as never, tracker, now),
  ).resolves.toBeNull()
})
