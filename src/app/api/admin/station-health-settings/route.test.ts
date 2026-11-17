// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserWithRole: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getUserWithRole: mocks.getUserWithRole,
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

describe('owner station-health settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserWithRole.mockResolvedValue({
      user: { id: 'owner-1', email: 'owner@example.com' },
      role: 'owner',
    })
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'system_settings') throw new Error('Unexpected table')
      return { upsert: mocks.upsert }
    })
  })

  it('preserves owner/admin authorization', async () => {
    mocks.getUserWithRole.mockResolvedValue({
      user: { id: 'dispatcher-1', email: 'dispatcher@example.com' },
      role: 'dispatcher',
    })
    const { PUT } = await import('./route')
    const { NextRequest } = await import('next/server')

    const response = await PUT(
      new NextRequest('http://localhost/api/admin/station-health-settings', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      }),
    )

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('persists an explicit OFF owner choice', async () => {
    const { PUT } = await import('./route')
    const { NextRequest } = await import('next/server')

    const response = await PUT(
      new NextRequest('http://localhost/api/admin/station-health-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ enabled: false, source: 'saved' })
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'station_health_partner_sms_enabled',
        value: { enabled: false },
      }),
      { onConflict: 'key' },
    )
  })
})
