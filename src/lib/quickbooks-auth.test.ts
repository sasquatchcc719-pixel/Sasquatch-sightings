import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  row: {} as Record<string, any>,
  saveFailures: 0,
}))
vi.mock('@/lib/quickbooks-crypto', () => ({
  encrypt: (s: string) => `encrypted:${s}`,
  decrypt: (s: string) => s.replace(/^encrypted:/, ''),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null
      const filters: Array<[string, unknown]> = []
      let checkLease = false
      const execute = () => {
        const matches =
          filters.every(([key, value]) => state.row[key] === value) &&
          (!checkLease ||
            !state.row.refresh_lock_until ||
            new Date(state.row.refresh_lock_until).getTime() < Date.now())
        if (!matches) return { data: null, error: null }
        if (patch?.access_token && state.saveFailures > 0) {
          state.saveFailures--
          return { data: null, error: new Error('Temporary DB outage') }
        }
        if (patch) Object.assign(state.row, patch)
        return { data: { ...state.row }, error: null }
      }
      const q: any = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (key: string, value: unknown) => {
          filters.push([key, value])
          return q
        },
        or: () => {
          checkLease = true
          return q
        },
        update: (value: Record<string, unknown>) => {
          patch = value
          return q
        },
        maybeSingle: async () => execute(),
        then: (resolve: any, reject: any) =>
          Promise.resolve(execute()).then(resolve, reject),
      }
      return q
    },
  }),
}))

import {
  getQBConnectionStatus,
  getValidQBAccessToken,
  saveQBTokens,
} from './quickbooks-auth'

const tokens = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  expires_in: 3600,
  x_refresh_token_expires_in: 8640000,
}
const freshExpiry = () => new Date(Date.now() + 3600000).toISOString()

beforeEach(() => {
  state.saveFailures = 0
  state.row = {
    id: 'token-row',
    realm_id: 'encrypted:company',
    access_token: 'encrypted:old-access',
    refresh_token: 'encrypted:old-refresh',
    access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    refresh_lock_id: null,
    refresh_lock_until: null,
    auth_error: null,
    sync_enabled: true,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(tokens)),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('QuickBooks token renewal', () => {
  it('shares one renewal across simultaneous callers', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getValidQBAccessToken()),
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r?.accessToken === 'new-access')).toBe(true)
    expect(state.row.refresh_token).toBe('encrypted:new-refresh')
    expect(state.row.refresh_lock_id).toBeNull()
  })

  it('preserves a deliberately disabled auto-sync switch', async () => {
    state.row.sync_enabled = false
    await getValidQBAccessToken()
    expect(state.row.sync_enabled).toBe(false)
  })

  it('retains a rotated token through a temporary database save failure', async () => {
    state.saveFailures = 1
    expect((await getValidQBAccessToken())?.accessToken).toBe('new-access')
    expect(state.row.refresh_token).toBe('encrypted:new-refresh')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('waits for another worker that owns the database lease', async () => {
    state.row.refresh_lock_id = 'other-worker'
    state.row.refresh_lock_until = freshExpiry()
    const pending = getValidQBAccessToken()
    await new Promise((resolve) => setTimeout(resolve, 10))
    Object.assign(state.row, {
      access_token: 'encrypted:other-access',
      refresh_token: 'encrypted:other-refresh',
      access_token_expires_at: freshExpiry(),
      refresh_lock_id: null,
      refresh_lock_until: null,
    })
    expect(await pending).toEqual({
      accessToken: 'other-access',
      realmId: 'company',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not overwrite a newer user authorization with a stale refresh response', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      Object.assign(state.row, {
        access_token: 'encrypted:reconnected-access',
        refresh_token: 'encrypted:reconnected-refresh',
        access_token_expires_at: freshExpiry(),
        refresh_lock_id: null,
        refresh_lock_until: null,
      })
      return Response.json(tokens)
    })
    expect(await getValidQBAccessToken()).toEqual({
      accessToken: 'reconnected-access',
      realmId: 'company',
    })
    expect(state.row.refresh_token).toBe('encrypted:reconnected-refresh')
  })

  it('uses newer credentials when an old renewal is rejected during reconnection', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      Object.assign(state.row, {
        access_token: 'encrypted:reconnected-access',
        refresh_token: 'encrypted:reconnected-refresh',
        access_token_expires_at: freshExpiry(),
        refresh_lock_id: null,
        refresh_lock_until: null,
      })
      return Response.json({ error: 'invalid_grant' }, { status: 400 })
    })
    expect((await getValidQBAccessToken())?.accessToken).toBe(
      'reconnected-access',
    )
    expect(state.row.auth_error).toBeNull()
  })

  it('records rejected authorization instead of falsely showing connected until January', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    )
    await expect(getValidQBAccessToken()).rejects.toThrow(
      'Reconnect QuickBooks',
    )
    expect(state.row.auth_error).toBe('invalid_grant')
    expect(state.row.refresh_lock_id).toBeNull()
    const status = await getQBConnectionStatus()
    expect(status.connected).toBe(false)
    expect(status.reconnect_required).toBe(true)
    await expect(getValidQBAccessToken()).rejects.toThrow(
      'Reconnect QuickBooks',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not mark temporary network failures as revoked authorization', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network timeout'))
    await expect(getValidQBAccessToken()).rejects.toThrow('network timeout')
    expect(state.row.auth_error).toBeNull()
    expect(state.row.refresh_lock_id).toBeNull()
  })

  it('allows a new authorization to clear rejection and stale lease state', async () => {
    Object.assign(state.row, {
      auth_error: 'invalid_grant',
      refresh_lock_id: 'dead-worker',
      refresh_lock_until: freshExpiry(),
    })
    await saveQBTokens({
      realmId: 'company',
      accessToken: 'authorized',
      refreshToken: 'authorized-refresh',
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 8640000,
    })
    expect(state.row.auth_error).toBeNull()
    expect(state.row.refresh_lock_id).toBeNull()
    expect((await getQBConnectionStatus()).connected).toBe(true)
  })
})
