// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DAVID_CANVASS_USER_ID } from '@/lib/gps/canvassAutoStop'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  createClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.createClient }))

const truck = {
  id: 'box-truck',
  enabled: true,
  last_seen_at: '2026-11-13T16:00:00Z',
  gps_fix: true,
  gps_at: '2026-11-13T16:00:00Z',
  speed_mps: 10,
}

const link = { token_hash: 'private-hash' }
const enRoute = {
  status: 'en_route',
  latitude: 39,
  longitude: -104,
  destination_lat: 39.1,
  destination_lng: -104.1,
}

function query(data: unknown) {
  const builder = { maybeSingle: vi.fn().mockResolvedValue({ data }) }
  return Object.assign(builder, {
    select: vi.fn().mockReturnValue(builder),
    eq: vi.fn().mockReturnValue(builder),
    in: vi.fn().mockReturnValue(builder),
    gte: vi.fn().mockReturnValue(builder),
    order: vi.fn().mockReturnValue(builder),
    limit: vi.fn().mockReturnValue(builder),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T16:00:00Z'))
  vi.stubEnv('MAPBOX_TOKEN', 'test-route-token')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: 'Ok', routes: [{ duration: 390 }] }),
      ),
  )
  mocks.access.mockResolvedValue({
    id: DAVID_CANVASS_USER_ID,
    staff: { id: 'david-staff-id', is_active: true },
  })
  mocks.createClient.mockReturnValue({ from: mocks.from, rpc: mocks.rpc })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('limits the live arrival window to David and his assigned truck and job', async () => {
  const trackers = query(truck)
  const links = query(link)
  mocks.from.mockReturnValueOnce(trackers).mockReturnValueOnce(links)
  mocks.rpc.mockImplementation(() => query(enRoute))

  const response = await GET()
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(await response.json()).toEqual({
    vehicleStatus: 'Moving',
    arrival: {
      status: 'en_route',
      earliest: '2026-11-13T16:07:00.000Z',
      latest: '2026-11-13T16:12:00.000Z',
      arrivingSoon: false,
    },
  })
  expect(trackers.eq).toHaveBeenCalledWith(
    'fleet_dispatch_tracking.staff_user_id',
    'david-staff-id',
  )
  expect(links.eq).toHaveBeenCalledWith('tracker_id', truck.id)
  expect(links.in).toHaveBeenCalledWith(
    'ops_appointments.assigned_staff_user_id',
    ['david-staff-id', DAVID_CANVASS_USER_ID],
  )
})

it('clears the ETA if the customer link ends while directions are loading', async () => {
  mocks.from.mockReturnValueOnce(query(truck)).mockReturnValueOnce(query(link))
  mocks.rpc
    .mockReturnValueOnce(query(enRoute))
    .mockReturnValueOnce(query({ status: 'arrived' }))

  expect(await (await GET()).json()).toEqual({
    vehicleStatus: 'Moving',
    arrival: { status: 'arrived' },
  })
})

it('rejects other technicians before loading tracker data', async () => {
  mocks.access.mockResolvedValue({
    id: 'other-tech',
    staff: { is_active: true },
  })
  expect((await GET()).status).toBe(401)
  expect(mocks.createClient).not.toHaveBeenCalled()
})
