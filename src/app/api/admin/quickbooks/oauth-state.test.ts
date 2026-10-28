// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQBState, QB_STATE_COOKIE } from '@/lib/quickbooks-oauth-state'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  buildUrl: vi.fn(),
  redirectUri: vi.fn(),
  exchange: vi.fn(),
  save: vi.fn(),
  resume: vi.fn(),
  admin: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  getUserWithRole: mocks.access,
  hasRoleAccess: (role: string) => ['admin', 'owner'].includes(role),
}))
vi.mock('@/lib/quickbooks-auth', () => ({
  buildQBAuthUrl: mocks.buildUrl,
  getQBRedirectUri: mocks.redirectUri,
  exchangeCodeForTokens: mocks.exchange,
  saveQBTokens: mocks.save,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  resumeQuickBooksAuthorizationJobs: mocks.resume,
}))
import { GET as connect } from './connect/route'
import { GET as callback } from './callback/route'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'test-only-oauth-signing-secret')
  mocks.access.mockResolvedValue({ user: { id: 'owner-1' }, role: 'owner' })
  mocks.redirectUri.mockReturnValue(
    'https://example.test/api/admin/quickbooks/callback',
  )
  mocks.buildUrl.mockImplementation(
    (state) => `https://appcenter.intuit.com/connect/oauth2?state=${state}`,
  )
  mocks.exchange.mockResolvedValue({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_in: 3600,
    x_refresh_token_expires_in: 10000,
  })
  mocks.admin.mockReturnValue({ test: 'database' })
})
afterEach(() => vi.unstubAllEnvs())

function responseFor(
  cookie?: string,
  state?: string,
  extra: Record<string, string> = {},
) {
  const url = new URL('https://example.test/api/admin/quickbooks/callback')
  for (const [key, value] of Object.entries({
    code: 'code-1',
    realmId: 'realm-1',
    ...(state ? { state } : {}),
    ...extra,
  }))
    url.searchParams.set(key, value)
  return callback(
    new NextRequest(url, {
      headers: cookie ? { cookie: `${QB_STATE_COOKIE}=${cookie}` } : {},
    }),
  )
}
function expectNoProviderOrDatabaseAccess() {
  expect(mocks.exchange).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.admin).not.toHaveBeenCalled()
  expect(mocks.resume).not.toHaveBeenCalled()
}

describe('QuickBooks OAuth state', () => {
  it('launches with a signed secure host-only browser cookie and random state', async () => {
    const response = await connect(
      new NextRequest('https://example.test/api/admin/quickbooks/connect'),
    )
    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/)
    const cookie = response.headers.get('set-cookie')!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=lax')
    expect(cookie).toContain('Path=/api/admin/quickbooks')
    expect(cookie).toContain('Max-Age=600')
    expect(cookie).not.toContain('Domain=')
    const finished = await responseFor(
      response.cookies.get(QB_STATE_COOKIE)?.value,
      location.searchParams.get('state')!,
    )
    expect(finished.headers.get('location')).toContain('qb_connected=1')
    expect(mocks.save).toHaveBeenCalledWith({
      realmId: 'realm-1',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 10000,
    })
    expect(mocks.resume).toHaveBeenCalledWith({ test: 'database' }, true)
    expect(finished.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('starts on the configured callback host before setting any cookie', async () => {
    const response = await connect(
      new NextRequest(
        'https://preview.example.test/api/admin/quickbooks/connect',
      ),
    )
    expect(response.headers.get('location')).toBe(
      'https://example.test/api/admin/quickbooks/connect',
    )
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mocks.buildUrl).not.toHaveBeenCalled()
    expectNoProviderOrDatabaseAccess()
  })

  it.each([
    'missing-cookie',
    'missing-state',
    'wrong-state',
    'tampered-cookie',
    'expired',
    'different-owner',
    'old-unsigned-cookie',
  ])('denies %s before exchanging codes or saving tokens', async (kind) => {
    const signed = createQBState(
      'owner-1',
      kind === 'expired' ? Date.now() - 11 * 60 * 1000 : Date.now(),
    )
    if (kind === 'different-owner')
      mocks.access.mockResolvedValue({ user: { id: 'owner-2' }, role: 'owner' })
    const cookie =
      kind === 'missing-cookie'
        ? undefined
        : kind === 'tampered-cookie'
          ? `${signed.cookie}tampered`
          : kind === 'old-unsigned-cookie'
            ? signed.state
            : signed.cookie
    const state =
      kind === 'missing-state'
        ? undefined
        : kind === 'wrong-state'
          ? 'a'.repeat(64)
          : signed.state
    const response = await responseFor(cookie, state)
    expect(response.headers.get('location')).toContain('qb_error=invalid_state')
    expectNoProviderOrDatabaseAccess()
  })

  it('handles a provider cancellation only after validating browser state', async () => {
    const signed = createQBState('owner-1')
    const response = await responseFor(signed.cookie, signed.state, {
      error: 'access_denied',
    })
    expect(response.headers.get('location')).toContain('qb_error=access_denied')
    expectNoProviderOrDatabaseAccess()
  })

  it.each([null, 'partner', 'dispatcher', 'client_manager'])(
    'denies role %s before OAuth launch or exchange',
    async (role) => {
      mocks.access.mockResolvedValue({
        user: role ? { id: 'other' } : null,
        role,
      })
      expect(
        (
          await connect(
            new NextRequest(
              'https://example.test/api/admin/quickbooks/connect',
            ),
          )
        ).status,
      ).toBe(401)
      const response = await responseFor()
      expect(response.headers.get('location')).toContain(
        'qb_error=unauthorized',
      )
      expect(mocks.buildUrl).not.toHaveBeenCalled()
      expectNoProviderOrDatabaseAccess()
    },
  )
})
