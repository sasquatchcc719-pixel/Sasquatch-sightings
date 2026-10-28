// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  invoice: vi.fn(),
  sign: vi.fn(),
  build: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.role }))
vi.mock('@/lib/tech/appointments', () => ({
  getChargeableInvoice: mocks.invoice,
}))
vi.mock('@/lib/payments/square-pos-verification', () => ({
  createSquarePosContext: mocks.sign,
}))
vi.mock('@/lib/payments/square-pos', () => ({
  buildSquarePosUrl: mocks.build,
  detectMobilePlatform: () => 'ios',
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
import { POST } from './route'
const params = { params: Promise.resolve({ id: 'visit-1' }) }
function request(returnTo?: string) {
  return new NextRequest('https://example.test/api/charge', {
    method: 'POST',
    body: JSON.stringify({ returnTo }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('SQUARE_APPLICATION_ID', 'app-1')
  vi.stubEnv('SQUARE_ACCESS_TOKEN', 'token-1')
  vi.stubEnv('SQUARE_LOCATION_ID', 'location-1')
  mocks.role.mockResolvedValue({
    id: 'actor-1',
    role: 'tech',
    staff: { id: 'staff-1' },
  })
  mocks.invoice.mockResolvedValue({
    invoiceId: 'invoice-1',
    invoiceNumber: 12345,
    total: 100,
  })
  mocks.sign.mockReturnValue({ state: 'signed-context', note: 'verified-note' })
  mocks.build.mockReturnValue('square-commerce-v1://payment')
})
afterEach(() => vi.unstubAllEnvs())
describe('invoice POS launch', () => {
  it('signs real invoice identity and server amount while preserving invoice-number reference for webhook', async () => {
    const response = await POST(request(), params)
    expect(response.status).toBe(200)
    expect(mocks.sign).toHaveBeenCalledWith({
      purpose: 'invoice',
      invoiceId: 'invoice-1',
      invoiceNumber: 12345,
      appointmentId: 'visit-1',
      amountCents: 10000,
      kind: 'payment',
      actorId: 'actor-1',
      returnTo: '/tech/jobs/visit-1',
    })
    expect(mocks.build).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'signed-context',
        note: 'verified-note',
        locationId: 'location-1',
      }),
    )
  })
  it('does not launch charges if provider verification is unavailable', async () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', '')
    expect((await POST(request(), params)).status).toBe(503)
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('does not sign arbitrary external return paths', async () => {
    await POST(request('/\\evil.test'), params)
    expect(mocks.sign.mock.calls[0][0].returnTo).toBe('/tech/jobs/visit-1')
  })
})
