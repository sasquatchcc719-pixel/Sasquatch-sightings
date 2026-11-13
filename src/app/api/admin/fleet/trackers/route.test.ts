import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  progress: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/lib/gps/david-canvass-status', () => ({
  readDavidCanvassStatus: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/ops/box-truck-travel', () => ({
  readBoxTruckTravelProgress: mocks.progress,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'
const request = new NextRequest('https://example.test/api/admin/fleet/trackers')
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({})
  mocks.from.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ order: mocks.order })
  mocks.order.mockResolvedValue({ data: [], error: null })
  mocks.progress.mockResolvedValue(null)
})
it('adds active trip details without exposing the private arrival token', async () => {
  const tracker = {
    id: 'tracker-1',
    name: "David's Box Truck",
    enabled: true,
  }
  mocks.order.mockResolvedValue({ data: [tracker], error: null })
  mocks.progress.mockResolvedValue({
    destinationName: 'Customer',
    eta: '2026-11-13T16:10:00.000Z',
    minutesRemaining: 10,
    milesRemaining: 1,
    progressPercent: 80,
  })
  const response = await GET(
    new NextRequest('https://example.test/api/admin/fleet/trackers?activity=1'),
  )
  const body = await response.json()
  expect(body.travelProgress).toMatchObject({ progressPercent: 80 })
  expect(mocks.progress).toHaveBeenCalledWith(
    expect.objectContaining({ from: mocks.from }),
    tracker,
  )
  expect(JSON.stringify(body)).not.toContain('token_hash')
})
it('requires dispatch access to vehicle locations', async () => {
  mocks.guard.mockRejectedValue(new Error('Unauthorized'))
  expect((await GET(request)).status).toBe(401)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('never exposes token hashes through the dashboard API', async () => {
  expect((await GET(request)).status).toBe(200)
  expect(mocks.guard).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
  expect(mocks.select.mock.calls[0][0]).not.toContain('token_hash')
  expect(mocks.select.mock.calls[0][0]).not.toBe('*')
})
