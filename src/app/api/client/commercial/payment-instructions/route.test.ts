import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireClientManager: vi.fn(),
  loadInstructions: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireClientManager: mocks.requireClientManager,
}))
vi.mock('@/lib/ops/commercial-payment-server', () => ({
  loadCommercialAchInstructions: mocks.loadInstructions,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClientManager.mockResolvedValue({
    client: { customer_id: 'customer-a' },
  })
  mocks.loadInstructions.mockReturnValue({
    beneficiaryName: 'Example Cleaning Company',
    bankName: 'Example Bank',
    routingNumber: '123456789',
    accountNumber: '123456789012',
    accountType: 'Checking',
    remittanceEmail: 'billing@example.com',
  })
})

describe('commercial ACH payment instructions', () => {
  it('returns server-held instructions only after client-manager authorization', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.requireClientManager).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({
      instructions: expect.objectContaining({
        beneficiaryName: 'Example Cleaning Company',
        routingNumber: '123456789',
      }),
    })
  })

  it('does not return banking details to an unauthorized user', async () => {
    mocks.requireClientManager.mockRejectedValue(
      new Error('Not a client manager'),
    )

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mocks.loadInstructions).not.toHaveBeenCalled()
  })
})
