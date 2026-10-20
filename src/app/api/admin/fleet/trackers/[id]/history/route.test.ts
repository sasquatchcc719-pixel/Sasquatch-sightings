import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
import { GET } from './route'
const id = '7a092418-a1be-4d3a-811e-bb1ab72e0d99'
function request(start: string, end: string) {
  return new NextRequest(
    `https://example.test/history?${new URLSearchParams({ start, end })}`,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({})
  mocks.rpc.mockResolvedValue({ data: [], error: null })
})
it('requires dispatch access to movement history', async () => {
  mocks.guard.mockRejectedValue(new Error('Unauthorized'))
  expect(
    (
      await GET(request('2026-10-19T06:00:00Z', '2026-10-20T06:00:00Z'), {
        params: Promise.resolve({ id }),
      })
    ).status,
  ).toBe(401)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('rejects an unlimited or reversed history range before querying', async () => {
  for (const [start, end] of [
    ['2026-01-01', '2026-10-20'],
    ['2026-10-20', '2026-10-19'],
    ['bad', '2026-10-20'],
  ]) {
    expect(
      (await GET(request(start, end), { params: Promise.resolve({ id }) }))
        .status,
    ).toBe(400)
  }
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('accepts the 25-hour Mountain Time day at the end of daylight saving time', async () => {
  const response = await GET(
    request('2026-11-01T06:00:00Z', '2026-11-02T07:00:00Z'),
    { params: Promise.resolve({ id }) },
  )
  expect(response.status).toBe(200)
  expect(mocks.guard).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
  expect(mocks.rpc).toHaveBeenCalledWith('fleet_tracker_history', {
    p_tracker_id: id,
    p_start: '2026-11-01T06:00:00.000Z',
    p_end: '2026-11-02T07:00:00.000Z',
  })
})
