// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), fetch: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))

import { loadCustomerArrival } from './customer-arrival'

const token = 'A'.repeat(43)
const enRoute = {
  status: 'en_route',
  latitude: 39,
  longitude: -104,
  destination_lat: 39.1,
  destination_lng: -104.1,
}

function readTrip(...rows: object[]) {
  const maybeSingle = vi.fn()
  for (const row of rows) maybeSingle.mockResolvedValueOnce({ data: row })
  mocks.rpc.mockReturnValue({ maybeSingle })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('MAPBOX_TOKEN', 'test-route-token')
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.db.mockReturnValue({ rpc: mocks.rpc })
  mocks.fetch.mockResolvedValue(
    Response.json({ code: 'Ok', routes: [{ duration: 240 }] }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('returns only a time range and progress for a fresh trip', async () => {
  readTrip(enRoute, enRoute)
  expect(await loadCustomerArrival(token)).toEqual({
    status: 'en_route',
    earliest: expect.any(String),
    latest: expect.any(String),
    arrivingSoon: true,
  })
})

it('withholds an ETA if the truck arrives during routing', async () => {
  readTrip(enRoute, { status: 'arrived' })
  expect(await loadCustomerArrival(token)).toEqual({ status: 'arrived' })
})

it.each(['waiting', 'arrived', 'ended'])(
  'skips routing when status is %s',
  async (status) => {
    readTrip({ status })
    expect(await loadCustomerArrival(token)).toEqual({ status })
    expect(mocks.fetch).not.toHaveBeenCalled()
  },
)

it('never looks up a malformed token', async () => {
  expect(await loadCustomerArrival('invalid')).toEqual({ status: 'ended' })
  expect(mocks.db).not.toHaveBeenCalled()
})
