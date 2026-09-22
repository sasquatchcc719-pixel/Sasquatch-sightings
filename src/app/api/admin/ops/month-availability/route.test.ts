// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  admin: vi.fn(),
  forStaff: vi.fn(),
  unioned: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/ops/staff-availability', () => ({
  getSlotsForStaff: mocks.forStaff,
  getUnionedSlots: mocks.unioned,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ role: 'owner' })
  const appointmentsQuery = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    neq: vi.fn().mockResolvedValue({ data: [], error: null }),
  }
  mocks.admin.mockReturnValue({
    from: vi.fn().mockReturnValue(appointmentsQuery),
  })
  mocks.forStaff.mockResolvedValue([
    { start_time: '11:00:00', end_time: '13:00:00' },
  ])
})

describe('month availability duration contract', () => {
  it('colors days using the same complete occupancy as the slot picker', async () => {
    const response = await GET(
      new NextRequest(
        'https://example.com/api/admin/ops/month-availability?start_date=2026-09-23&end_date=2026-09-23&staff_user_id=staff-a&required_minutes=120',
      ),
    )

    expect(response.status).toBe(200)
    expect(mocks.forStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-09-23',
        staffUserId: 'staff-a',
        requiredMinutes: 120,
      }),
    )
    expect(await response.json()).toMatchObject({
      days: [{ date: '2026-09-23', slots: 1, is_available: true }],
    })
  })
})
