import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSquarePaymentLink } from './square'

describe('createSquarePaymentLink', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('includes the human invoice number throughout the Square request', async () => {
    vi.stubEnv('SQUARE_ACCESS_TOKEN', 'test-token')
    vi.stubEnv('SQUARE_LOCATION_ID', 'test-location')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            payment_link: {
              id: 'square-link-id',
              order_id: 'square-order-id',
              url: 'https://square.link/u/example',
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const paymentLink = await createSquarePaymentLink({
      invoiceId: 'internal-invoice-uuid',
      invoiceNumber: 18209,
      amount: 675,
      customerName: 'Tamara Jarka',
      description: '18380 Academy Circle',
    })

    const fetchMock = vi.mocked(fetch)
    const request = fetchMock.mock.calls[0]
    const body = JSON.parse(String(request[1]?.body))

    expect(body.quick_pay.name).toContain('Invoice #18209')
    expect(body.description).toContain('Invoice #18209')
    expect(body.pre_populated_data.buyer_note).toContain('Invoice #18209')
    expect(body.idempotency_key).toContain('internal-invoice-uuid')
    expect(paymentLink).toEqual({
      id: 'square-link-id',
      orderId: 'square-order-id',
      url: 'https://square.link/u/example',
    })
  })
})
