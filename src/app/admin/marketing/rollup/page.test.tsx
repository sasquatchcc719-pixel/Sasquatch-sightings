import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  role: 'owner' as string | null,
  redirect: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({
  getUserWithRole: async () => ({ role: mocks.role }),
  hasRoleAccess: (role: string | null, allowed: string[]) =>
    role !== null && allowed.includes(role),
}))
vi.mock('@/components/admin/business-decision-view', () => ({
  BusinessDecisionView: () => <div>Owner decisions</div>,
}))
vi.mock('@/components/admin/marketing/WeeklyRollupView', () => ({
  WeeklyRollupView: () => <div>Historical marketing view</div>,
}))
import MarketingRollupPage from './page'
beforeEach(() => {
  mocks.role = 'owner'
  mocks.redirect.mockReset().mockImplementation((path) => {
    throw new Error(`redirect:${path}`)
  })
})
afterEach(cleanup)
it.each(['owner', 'admin'])(
  'shows decisions and optional history for %s',
  async (role) => {
    mocks.role = role
    render(await MarketingRollupPage())
    expect(screen.getByText('Owner decisions')).toBeVisible()
    expect(
      screen.getByText('Historical marketing view').closest('details'),
    ).not.toHaveAttribute('open')
  },
)
it('preserves marketing history without requesting the owner snapshot', async () => {
  mocks.role = 'marketing'
  render(await MarketingRollupPage())
  expect(screen.getByText('Historical marketing view')).toBeVisible()
  expect(screen.queryByText('Owner decisions')).not.toBeInTheDocument()
})
it.each(['dispatcher', 'tech', 'partner', null])(
  'does not expand access for %s',
  async (role) => {
    mocks.role = role
    await expect(MarketingRollupPage()).rejects.toThrow('redirect:/admin')
  },
)
