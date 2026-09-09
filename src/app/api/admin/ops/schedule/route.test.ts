// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  requireAnyRole: vi.fn().mockResolvedValue({ id: 'owner' }),
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
import { GET } from './route'

describe('schedule estimate history', () => {
  it('hides cancelled estimates while keeping active visits and cancelled jobs', async () => {
    const appointments = [
      {
        id: 'empty-estimate',
        kind: 'estimate',
        status: 'cancelled',
        customer_id: 'customer',
      },
      {
        id: 'active-estimate',
        kind: 'estimate',
        status: 'confirmed',
        customer_id: 'customer',
      },
      {
        id: 'cancelled-job',
        kind: 'service',
        status: 'cancelled',
        customer_id: 'customer',
      },
      {
        id: 'legacy-job',
        kind: null,
        status: 'cancelled',
        customer_id: 'customer',
      },
      {
        id: 'booked-job',
        kind: 'service',
        status: 'booked',
        customer_id: 'customer',
      },
    ]
    let appointmentReads = 0
    mocks.from.mockImplementation((table: string) => {
      const data =
        table === 'ops_appointments' && appointmentReads++ === 0
          ? appointments
          : []
      const query = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      }
      return query
    })
    const response = await GET(
      new NextRequest(
        'https://example.test/api/admin/ops/schedule?start_date=2026-09-09&end_date=2026-09-09',
      ),
    )
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.appointments.map((row: { id: string }) => row.id)).toEqual([
      'active-estimate',
      'cancelled-job',
      'legacy-job',
      'booked-job',
    ])
  })
})
