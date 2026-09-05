import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  requireClientManager: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireClientManager: mocks.requireClientManager,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))
vi.mock('@/lib/ops/commercial-server', () => ({ loadCommercialData: vi.fn() }))
import { PATCH } from './route'
import { emptyProfile } from '@/lib/ops/commercial'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClientManager.mockResolvedValue({
    user: { id: 'auth-a' },
    client: { customer_id: 'own-customer' },
  })
  mocks.upsert.mockResolvedValue({ error: null })
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
})
describe('customer business information', () => {
  it('saves legal name and access instructions only in the authenticated customer profile, leaving agreements untouched', async () => {
    const response = await PATCH(
      new NextRequest('https://example.com/api/client/commercial', {
        method: 'PATCH',
        body: JSON.stringify({
          ...emptyProfile,
          legal_name: 'Example Legal LLC',
          billing_contact: 'Alex Manager',
          access_instructions: 'Loading door after closing',
          customer_id: 'another-customer',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith('ops_commercial_profiles')
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: 'own-customer',
        legal_name: 'Example Legal LLC',
        access_instructions: 'Loading door after closing',
        updated_by: 'auth-a',
      }),
    )
  })
})
