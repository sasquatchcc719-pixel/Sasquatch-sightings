// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  validateTomorrowFillPromoToken: vi.fn(),
}))

vi.mock('@/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/ops/tomorrow-fill', () => ({
  validateTomorrowFillPromoToken: mocks.validateTomorrowFillPromoToken,
}))

import { GET } from './route'

describe('private offer checkout preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateTomorrowFillPromoToken.mockResolvedValue({
      offerCode: 'TF35',
      offerAmount: 35,
      minimumSubtotal: 300,
    })
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'promo',
          code: 'TF35',
          discount_type: 'fixed',
          discount_amount: 35,
          expires_at: null,
          max_uses: null,
          use_count: 0,
        },
        error: null,
      }),
    }
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => query) })
  })

  async function preview(subtotal: number) {
    return GET(
      new NextRequest(
        `https://example.com/api/public/promo-preview?code=TF35&subtotal=${subtotal}&tomorrow_fill_token=private-token`,
      ),
    )
  }

  it('shows the $300 requirement without applying the discount below it', async () => {
    const response = await preview(299)
    expect(await response.json()).toMatchObject({
      discount_amount: 0,
      total: 299,
      applied: false,
      minimum_subtotal: 300,
      reason: 'minimum_subtotal',
    })
  })

  it('applies $35 at the exact $300 threshold', async () => {
    const response = await preview(300)
    expect(await response.json()).toMatchObject({
      discount_amount: 35,
      total: 265,
      applied: true,
      minimum_subtotal: 300,
    })
  })

  it('preserves the $250 minimum on previously issued offers', async () => {
    mocks.validateTomorrowFillPromoToken.mockResolvedValue({
      offerCode: 'TF35',
      offerAmount: 35,
      minimumSubtotal: 250,
    })
    const response = await preview(250)
    expect(await response.json()).toMatchObject({
      discount_amount: 35,
      total: 215,
      minimum_subtotal: 250,
    })
  })

  it('rejects invalid or expired private links', async () => {
    mocks.validateTomorrowFillPromoToken.mockResolvedValue(null)
    const response = await preview(300)
    expect(response.status).toBe(409)
  })
})
