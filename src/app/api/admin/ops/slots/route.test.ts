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
  mocks.admin.mockReturnValue({ from: vi.fn() })
  mocks.forStaff.mockResolvedValue([
    { start_time: '11:00:00', end_time: '13:00:00' },
  ])
})

describe('admin slot duration contract', () => {
  it('uses the complete requested occupancy without adding a second buffer', async () => {
    const response = await GET(
      new NextRequest(
        'https://example.com/api/admin/ops/slots?date=2026-09-23&staff_user_id=staff-a&required_minutes=120',
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
    expect(await response.json()).toMatchObject({ requiredMinutes: 120 })
  })
})
