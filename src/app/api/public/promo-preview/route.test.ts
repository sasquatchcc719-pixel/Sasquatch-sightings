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

describe('public NEXTDOOR35 preview', () => {
  beforeEach(() => {
    const q = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({
          data: {
            id: 'nextdoor-promo',
            code: 'NEXTDOOR35',
            discount_type: 'tiered',
            discount_amount: 0,
            expires_at: null,
            max_uses: null,
            use_count: 0,
          },
          error: null,
        }),
    }
    mocks.createAdminClient.mockReturnValue({ from: vi.fn(() => q) })
  })
  it('needs no private token and applies exactly35 at300 services', async () => {
    const r = await GET(
      new NextRequest(
        'https://example.test/api/public/promo-preview?code=NEXTDOOR35&subtotal=300&service_subtotal=300',
      ),
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({
      discount_amount: 35,
      total: 265,
      applied: true,
      minimum_subtotal: 300,
      stacking: false,
    })
  })
  it('does not qualify299.99 services plus fees or accept an unspecified service basis', async () => {
    const r = await GET(
      new NextRequest(
        'https://example.test/api/public/promo-preview?code=NEXTDOOR35&subtotal=324.99&service_subtotal=299.99',
      ),
    )
    expect(await r.json()).toMatchObject({
      discount_amount: 0,
      applied: false,
      total: 324.99,
    })
    const missing = await GET(
      new NextRequest(
        'https://example.test/api/public/promo-preview?code=NEXTDOOR35&subtotal=300',
      ),
    )
    expect(missing.status).toBe(400)
  })
})
