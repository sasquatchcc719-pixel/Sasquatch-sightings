import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAnyRole: vi.fn(),
  readCellularUsage: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.requireAnyRole }))
vi.mock('@/lib/hologram-usage', () => ({
  readCellularUsage: mocks.readCellularUsage,
}))

import { GET } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAnyRole.mockResolvedValue({ role: 'owner' })
  mocks.readCellularUsage.mockResolvedValue({
    usedBytes: 100_030_000,
    limitBytes: 1_000_000_000,
  })
})

it('returns carrier usage to operations roles without caching it', async () => {
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(mocks.requireAnyRole).toHaveBeenCalledWith([
    'admin',
    'owner',
    'dispatcher',
  ])
  expect(await response.json()).toMatchObject({ usedBytes: 100_030_000 })
})

it('does not call Hologram for an unauthorized request', async () => {
  mocks.requireAnyRole.mockRejectedValue(new Error('Unauthorized'))
  expect((await GET()).status).toBe(401)
  expect(mocks.readCellularUsage).not.toHaveBeenCalled()
})

it('does not expose provider errors', async () => {
  mocks.readCellularUsage.mockRejectedValue(new Error('secret provider body'))
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({
    error: 'Cellular usage is unavailable',
  })
})
