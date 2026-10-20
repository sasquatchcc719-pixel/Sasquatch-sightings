import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ role: 'owner', redirect: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth', async (original) => ({
  ...(await original<typeof import('@/lib/auth')>()),
  getUserWithRole: async () => ({ role: mocks.role }),
}))
vi.mock('@/components/admin/fleet-tracker-dashboard', () => ({
  default: () => <div>Shared vehicle dispatch</div>,
}))
import DispatchPage from './page'
import LegacyTrackingPage from '../../fleet/tracking/page'
beforeEach(() => {
  mocks.role = 'owner'
  mocks.redirect.mockReset().mockImplementation((path) => {
    throw new Error(`redirect:${path}`)
  })
})
afterEach(cleanup)
it.each(['owner', 'admin', 'dispatcher'])(
  'allows %s to use the shared dispatch workspace',
  async (role) => {
    mocks.role = role
    render(await DispatchPage())
    expect(screen.getByText('Shared vehicle dispatch')).toBeVisible()
    expect(mocks.redirect).not.toHaveBeenCalled()
  },
)
it('keeps technician accounts out of fleet location history', async () => {
  mocks.role = 'tech'
  await expect(DispatchPage()).rejects.toThrow('redirect:/admin')
})
it('redirects old tracking bookmarks to the same dispatch workspace', () => {
  expect(() => LegacyTrackingPage()).toThrow(
    'redirect:/admin/operations/dispatch',
  )
})
