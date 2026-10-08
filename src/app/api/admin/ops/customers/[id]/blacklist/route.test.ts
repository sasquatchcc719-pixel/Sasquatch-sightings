// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  suppress: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/customer-blacklist', () => ({
  suppressCustomersForBlacklistedPhone: mocks.suppress,
}))

import { DELETE, POST } from './route'

const context = { params: Promise.resolve({ id: 'customer-a' }) }

function customerQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'customer-a',
        full_name: 'Sherry Martin',
        business_name: null,
        phone: '+17606396281',
      },
      error: null,
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'owner-a', role: 'owner' })
  mocks.suppress.mockResolvedValue(['customer-a'])
})

describe('customer blacklist route', () => {
  it('blacklists the customer phone and suppresses pending communication', async () => {
    const insert = vi.fn().mockReturnThis()
    const blacklistQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert,
      single: vi.fn().mockResolvedValue({
        data: { id: 'blacklist-a', phone: '7606396281' },
        error: null,
      }),
    }
    const db = {
      from: vi.fn((table: string) =>
        table === 'ops_customers' ? customerQuery() : blacklistQuery,
      ),
    }
    mocks.db.mockReturnValue(db)

    const response = await POST(
      new NextRequest(
        'https://example.com/api/admin/ops/customers/customer-a/blacklist',
        {
          method: 'POST',
          body: JSON.stringify({ reason: 'Do not accept future bookings' }),
        },
      ),
      context,
    )

    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledWith({
      phone: '7606396281',
      name: 'Sherry Martin',
      reason: 'Do not accept future bookings',
    })
    expect(mocks.suppress).toHaveBeenCalledWith(db, '7606396281')
  })

  it('removes the customer phone from the blacklist', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn(() => ({ eq }))
    mocks.db.mockReturnValue({
      from: vi.fn((table: string) =>
        table === 'ops_customers'
          ? customerQuery()
          : {
              delete: remove,
            },
      ),
    })

    const response = await DELETE(
      new NextRequest(
        'https://example.com/api/admin/ops/customers/customer-a/blacklist',
        { method: 'DELETE' },
      ),
      context,
    )

    expect(response.status).toBe(200)
    expect(remove).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith('phone', '7606396281')
  })
})
