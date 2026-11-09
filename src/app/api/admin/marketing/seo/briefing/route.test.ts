// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), db: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/seo/briefing', () => ({ loadSeoBriefing: mocks.load }))
import { GET } from './route'
beforeEach(() => vi.resetAllMocks())
it('denies unauthorized reads before accessing any source', async () => {
  mocks.auth.mockRejectedValue(new Error('Not authorized'))
  expect((await GET()).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('returns private, uncached briefing for an authorized reader', async () => {
  mocks.auth.mockResolvedValue({ role: 'marketing' })
  mocks.load.mockResolvedValue({ sections: [] })
  const result = await GET()
  expect(result.status).toBe(200)
  expect(result.headers.get('Cache-Control')).toBe('private, no-store')
})
