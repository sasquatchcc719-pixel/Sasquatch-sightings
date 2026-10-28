// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ access: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getUserWithRole: mocks.access }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/components/admin/softphone', () => ({
  SoftphoneProvider: () => null,
}))
vi.mock('@/components/admin-navigation', () => ({
  AdminNavigation: () => null,
}))
vi.mock('@/components/admin/mobile-header', () => ({
  MobileHeader: () => null,
}))
vi.mock('@/components/admin/mobile-bottom-nav', () => ({
  MobileBottomNav: () => null,
}))
vi.mock('@/components/auth-button', () => ({ AuthButton: () => null }))
import AdminLayout from './layout'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`REDIRECT:${path}`)
  })
})

describe('admin layout membership', () => {
  it.each([
    [null, '/protected'],
    ['client_manager', '/protected'],
    ['partner', '/partners'],
    ['tech', '/tech'],
  ])(
    'redirects %s before rendering the admin shell',
    async (role, destination) => {
      mocks.access.mockResolvedValue({
        user: { id: 'user-1' },
        role,
        partner: null,
      })
      await expect(AdminLayout({ children: null })).rejects.toThrow(
        `REDIRECT:${destination}`,
      )
      expect(mocks.redirect).toHaveBeenCalledOnce()
    },
  )

  it('sends unauthenticated visitors to login', async () => {
    mocks.access.mockResolvedValue({ user: null, role: null, partner: null })
    await expect(AdminLayout({ children: null })).rejects.toThrow(
      'REDIRECT:/auth/login',
    )
  })

  it.each(['admin', 'owner', 'dispatcher', 'marketing'])(
    'preserves the %s admin shell',
    async (role) => {
      mocks.access.mockResolvedValue({
        user: { id: 'staff-1' },
        role,
        partner: null,
      })
      expect(await AdminLayout({ children: null })).toBeTruthy()
      expect(mocks.redirect).not.toHaveBeenCalled()
    },
  )
})
