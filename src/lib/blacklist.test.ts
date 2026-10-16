import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/onesignal', () => ({ sendOneSignalNotification: vi.fn() }))

import { isBlacklisted } from './blacklist'

describe('blacklist phone matching', () => {
  beforeEach(() => vi.clearAllMocks())

  function blacklist(phones: string[], error: unknown = null) {
    mocks.admin.mockReturnValue({
      rpc: vi.fn(async (_name, { p_phone }) => ({
        data: phones.some(
          (phone) => phone.replace(/\D/g, '').slice(-10) === p_phone,
        ),
        error,
      })),
    })
  }

  it.each(['4356719398', '+14356719398', '(435) 671-9398'])(
    'matches %s against a formatted stored entry',
    async (phone) => {
      blacklist(['+1 (435) 671-9398'])
      expect(await isBlacklisted(phone)).toBe(true)
      expect(mocks.admin().rpc).toHaveBeenCalledWith('is_phone_blacklisted', {
        p_phone: '4356719398',
      })
    },
  )

  it('allows a different number', async () => {
    blacklist(['4356719398'])
    expect(await isBlacklisted('7195550100')).toBe(false)
  })

  it('keeps blocking on a database error', async () => {
    blacklist([], { message: 'Database unavailable' })
    expect(await isBlacklisted('4356719398')).toBe(true)
  })

  it('does not query for an incomplete phone number', async () => {
    expect(await isBlacklisted('435')).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
