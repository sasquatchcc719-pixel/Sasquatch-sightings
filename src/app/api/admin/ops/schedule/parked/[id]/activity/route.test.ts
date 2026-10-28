// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  load: vi.fn(),
  client: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.guard }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/ops/unscheduled-activity', () => ({
  loadUnscheduledActivity: mocks.load,
}))
import { GET } from './route'
const context = {
  params: Promise.resolve({ id: '10000000-0000-4000-8000-000000000001' }),
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockResolvedValue({ id: 'owner' })
  mocks.load.mockResolvedValue({ events: [], limit: 100 })
})
it('requires operational access before exposing customer history', async () => {
  mocks.guard.mockRejectedValue(new Error('Not authorized'))
  expect((await GET(new Request('http://localhost'), context)).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('validates appointment IDs and returns private uncached history', async () => {
  expect(
    (
      await GET(new Request('http://localhost'), {
        params: Promise.resolve({ id: 'invalid' }),
      })
    ).status,
  ).toBe(400)
  expect(mocks.load).not.toHaveBeenCalled()
  const response = await GET(new Request('http://localhost'), context)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ events: [], limit: 100 })
})
