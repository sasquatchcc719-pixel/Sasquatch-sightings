// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))

vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))

import { GET } from './route'

describe('agent estimate pricing', () => {
  it('returns catalog pricing without an automatic AI discount', async () => {
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.in.mockReturnValue(query)
    query.eq.mockResolvedValue({
      data: [
        {
          id: 'service-1',
          name: 'Carpet cleaning',
          slug: 'carpet-cleaning',
          base_price: 230,
          pricing_unit: 'fixed',
          default_duration_minutes: 120,
        },
      ],
      error: null,
    })
    mocks.admin.mockReturnValue({
      from: vi.fn(() => query),
    })

    const response = await GET(
      new NextRequest(
        'https://example.com/api/agent/estimate?services=service-1',
      ),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ subtotal: 230, total: 230 })
    expect(body).not.toHaveProperty('promotion_applied')
    expect(body).not.toHaveProperty('note')
  })
})
