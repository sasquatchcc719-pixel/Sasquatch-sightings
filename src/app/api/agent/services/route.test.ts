// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn() }))

vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/service-area', () => ({
  getServiceAreaDescription: () => 'Colorado Springs area',
}))

import { GET } from './route'

describe('agent service catalog', () => {
  it('does not advertise an automatic AI promotion', async () => {
    const query = {
      select: vi.fn(),
      in: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.in.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValueOnce(query).mockResolvedValueOnce({
      data: [
        {
          id: 'service-1',
          name: 'Carpet cleaning',
          slug: 'carpet-cleaning',
          base_price: 300,
          category: 'Carpet Cleaning',
          description: 'Cleaning',
          pricing_unit: 'fixed',
          default_duration_minutes: 120,
        },
      ],
      error: null,
    })
    mocks.admin.mockReturnValue({
      from: vi.fn(() => query),
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.promotions).toEqual([])
    expect(body.services).toHaveLength(1)
  })
})
