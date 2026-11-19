import { beforeEach, expect, it, vi } from 'vitest'
import { setCoachingExcluded } from './actions'
const m = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getUserWithRole: m.auth }))
vi.mock('@/supabase/server', () => ({ createAdminClient: m.db }))
vi.mock('next/cache', () => ({ revalidatePath: m.refresh }))
const sid = 'CA' + 'f'.repeat(32)
beforeEach(() => vi.resetAllMocks())
it('rejects a technician before touching the review', async () => {
  m.auth.mockResolvedValue({ user: { id: 'tech' }, role: 'tech' })
  await expect(setCoachingExcluded(sid, true)).rejects.toThrow('Unauthorized')
  expect(m.db).not.toHaveBeenCalled()
})
it.each([true, false])(
  'can reversibly change coaching inclusion on the selected reviewed call',
  async (excluded) => {
    m.auth.mockResolvedValue({ user: { id: 'owner' }, role: 'owner' })
    const q = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { call_sid: sid } }),
    }
    m.db.mockReturnValue({ from: () => q })
    await setCoachingExcluded(sid, excluded)
    expect(q.update).toHaveBeenCalledWith({ coaching_excluded: excluded })
    expect(q.eq).toHaveBeenCalledWith('call_sid', sid)
    expect(m.refresh).toHaveBeenCalledWith('/admin/phone-assistant')
  },
)
