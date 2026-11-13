import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAnyRole: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.requireAnyRole }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({ select: mocks.select }),
    rpc: mocks.rpc,
  }),
}))

import { GET, PATCH } from './route'

const url = 'https://example.test/api/admin/fleet/temperature?days=90'

beforeEach(() => {
  vi.resetAllMocks()
  const query = { eq: mocks.eq, maybeSingle: mocks.maybeSingle }
  mocks.select.mockReturnValue(query)
  mocks.eq.mockReturnValue(query)
  mocks.requireAnyRole.mockImplementation(async (roles: string[]) => {
    if (!roles.includes('tech')) throw new Error('Not authorized')
    return { role: 'tech', staff: { id: 'assigned-tech' } }
  })
})

it('reads 90-day history for the assigned technician', async () => {
  mocks.maybeSingle.mockResolvedValue({
    data: { id: 'truck', probe_temperature_c: 10 },
  })
  mocks.rpc.mockResolvedValue({
    data: [{ low_f: 43, temperature_f: 50, high_f: 53 }],
  })
  const response = await GET(new NextRequest(url))
  expect(response.status).toBe(200)
  expect(mocks.select).toHaveBeenCalledWith(
    expect.stringContaining('fleet_dispatch_tracking!inner'),
  )
  expect(mocks.eq).toHaveBeenCalledWith(
    'fleet_dispatch_tracking.staff_user_id',
    'assigned-tech',
  )
  expect(mocks.rpc).toHaveBeenCalledWith('fleet_temperature_history_summary', {
    p_tracker_id: 'truck',
    p_days: 90,
  })
  expect(await response.json()).toMatchObject({
    temperatureF: 50,
    history: [{ low_f: 43, temperature_f: 50, high_f: 53 }],
  })
})

it('denies access when the technician does not have the truck assigned', async () => {
  mocks.maybeSingle.mockResolvedValue({ data: null })
  expect((await GET(new NextRequest(url))).status).toBe(401)
  expect(mocks.rpc).not.toHaveBeenCalled()
})

it('keeps alarm settings protected from technician writes', async () => {
  expect(
    (
      await PATCH(
        new NextRequest(url, {
          method: 'PATCH',
          body: JSON.stringify({ lowF: 40, highF: null }),
        }),
      )
    ).status,
  ).toBe(401)
  expect(mocks.select).not.toHaveBeenCalled()
})
