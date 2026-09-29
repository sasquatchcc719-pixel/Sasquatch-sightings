import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const REQUEST_ID = '11111111-1111-4111-8111-111111111111'
const mocks = vi.hoisted(() => ({
  requireClientManager: vi.fn(),
  requestAccess: vi.fn(),
  consumeAccess: vi.fn(),
  loadInstructions: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireClientManager: mocks.requireClientManager,
}))
vi.mock('@/lib/ops/commercial-ach-approval', () => ({
  requestCommercialAchAccess: mocks.requestAccess,
  consumeCommercialAchAccess: mocks.consumeAccess,
}))
vi.mock('@/lib/ops/commercial-payment-server', () => ({
  loadCommercialAchInstructions: mocks.loadInstructions,
}))

import { GET, POST } from './route'

function statusRequest() {
  return new NextRequest(
    `https://example.com/api/client/commercial/payment-instructions?request_id=${REQUEST_ID}`,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireClientManager.mockResolvedValue({
    user: { id: 'user-a', email: 'manager@example.com' },
    client: { customer_id: 'customer-a', display_name: 'Jamie Manager' },
  })
  mocks.requestAccess.mockResolvedValue({ id: REQUEST_ID, status: 'pending' })
  mocks.consumeAccess.mockResolvedValue({ status: 'pending' })
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
  it('records the authenticated portal user before requesting Telegram approval', async () => {
    const response = await POST()

    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.requestAccess).toHaveBeenCalledWith({
      customerId: 'customer-a',
      userId: 'user-a',
      requesterName: 'Jamie Manager',
      requesterEmail: 'manager@example.com',
    })
    expect(await response.json()).toEqual({
      request_id: REQUEST_ID,
      status: 'pending',
    })
    expect(mocks.loadInstructions).not.toHaveBeenCalled()
  })

  it('keeps banking details hidden while approval is pending', async () => {
    const response = await GET(statusRequest())

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ status: 'pending' })
    expect(mocks.loadInstructions).not.toHaveBeenCalled()
  })

  it('returns banking details only after the exact request is approved and consumed', async () => {
    mocks.consumeAccess.mockResolvedValue({ status: 'approved' })

    const response = await GET(statusRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.consumeAccess).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      customerId: 'customer-a',
      userId: 'user-a',
    })
    expect(await response.json()).toEqual({
      status: 'revealed',
      instructions: expect.objectContaining({
        beneficiaryName: 'Example Cleaning Company',
        routingNumber: '123456789',
      }),
    })
  })

  it.each([
    ['denied', 403],
    ['expired', 403],
    ['revealed', 403],
    ['delivery_failed', 403],
    ['not_found', 404],
  ])('does not reveal details for a %s request', async (status, code) => {
    mocks.consumeAccess.mockResolvedValue({ status })

    const response = await GET(statusRequest())

    expect(response.status).toBe(code)
    expect(mocks.loadInstructions).not.toHaveBeenCalled()
  })

  it('does not create requests or return details to unauthorized users', async () => {
    mocks.requireClientManager.mockRejectedValue(
      new Error('Not a client manager'),
    )

    expect((await POST()).status).toBe(403)
    expect((await GET(statusRequest())).status).toBe(403)
    expect(mocks.requestAccess).not.toHaveBeenCalled()
    expect(mocks.consumeAccess).not.toHaveBeenCalled()
    expect(mocks.loadInstructions).not.toHaveBeenCalled()
  })
})
