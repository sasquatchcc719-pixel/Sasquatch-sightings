import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({})
  mocks.from.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ order: mocks.order })
  mocks.order.mockResolvedValue({ data: [], error: null })
})
it('requires dispatch access to vehicle locations', async () => {
  mocks.guard.mockRejectedValue(new Error('Unauthorized'))
  expect((await GET()).status).toBe(401)
  expect(mocks.from).not.toHaveBeenCalled()
})
it('never exposes token hashes through the dashboard API', async () => {
  expect((await GET()).status).toBe(200)
  expect(mocks.guard).toHaveBeenCalledWith(['admin', 'owner', 'dispatcher'])
  expect(mocks.select.mock.calls[0][0]).not.toContain('token_hash')
  expect(mocks.select.mock.calls[0][0]).not.toBe('*')
})
