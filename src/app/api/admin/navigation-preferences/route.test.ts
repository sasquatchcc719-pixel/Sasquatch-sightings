import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_NAVIGATION_PREFERENCES } from '@/lib/admin-navigation'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  read: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getUserWithRole: mocks.access }))
vi.mock('@/lib/admin-navigation-server', () => ({
  readNavigationPreferences: mocks.read,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: mocks.upsert,
      delete: mocks.delete,
    }),
  }),
}))

import { DELETE, GET, PUT } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({
    user: { id: 'charles-user', email: 'charles@example.com' },
    role: 'owner',
  })
  mocks.read.mockResolvedValue(DEFAULT_NAVIGATION_PREFERENCES)
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.delete.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockResolvedValue({ error: null })
})

describe('personal navigation preference API', () => {
  it('returns only the authenticated account layout', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith('charles-user')
  })

  it('always writes the authenticated user id and sanitizes the layout', async () => {
    const request = new NextRequest(
      'https://example.test/api/admin/navigation-preferences',
      {
        method: 'PUT',
        body: JSON.stringify({
          user_id: 'somebody-else',
          preferences: {
            desktop: {
              sections: { operations: ['schedule', 'not-real'] },
              shortcuts: ['call-log'],
            },
            mobile: {
              sections: {},
              bottom: ['schedule', 'customers', 'stats', 'phone', 'fleet'],
            },
          },
        }),
      },
    )

    const response = await PUT(request)
    expect(response.status).toBe(200)
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'charles-user',
        preferences: expect.objectContaining({
          mobile: expect.objectContaining({
            bottom: ['schedule', 'customers', 'stats', 'phone'],
          }),
        }),
      }),
      { onConflict: 'user_id' },
    )
  })

  it('resets only the authenticated account', async () => {
    const response = await DELETE()
    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'charles-user')
  })

  it('does not allow dispatcher accounts to edit layouts', async () => {
    mocks.access.mockResolvedValue({
      user: { id: 'dispatcher-user', email: 'dispatch@example.com' },
      role: 'dispatcher',
    })
    expect((await GET()).status).toBe(401)
    expect(
      (
        await PUT(
          new NextRequest(
            'https://example.test/api/admin/navigation-preferences',
            { method: 'PUT', body: '{}' },
          ),
        )
      ).status,
    ).toBe(401)
    expect((await DELETE()).status).toBe(401)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
