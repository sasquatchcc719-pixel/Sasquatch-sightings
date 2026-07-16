// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSquarePaymentTelegramMessage,
  parseCompletedSquarePayment,
  verifySquareWebhookSignature,
} from './square-webhook'

describe('Square webhook verification', () => {
  it("accepts Square's published signature test vector", () => {
    const body =
      '{"merchant_id":"MLEFBHHSJGVHD","type":"webhooks.test_notification","event_id":"ac3ac95b-f97d-458c-a6e6-18981597e05f","created_at":"2022-07-13T20:30:59.037339943Z","data":{"type":"webhooks","id":"bc368e64-01aa-407e-b46e-3231809b1129"}}'

    expect(
      verifySquareWebhookSignature({
        body,
        notificationUrl:
          'https://webhook.site/679a4f3a-dcfa-49ee-bac5-9d0edad886b9',
        signature: 'GF4YkrJgGBDZ9NIYbNXBnMzqb2HoL4RW/S6vkZ9/2N4=',
        signatureKey: 'Ibxx_5AKakO-3qeNVR61Dw',
      }),
    ).toBe(true)
  })

  it('rejects a changed body', () => {
    const body = '{"type":"payment.updated"}'
    const notificationUrl = 'https://example.com/api/webhooks/square'
    const signatureKey = 'signature-key'
    const signature = createHmac('sha256', signatureKey)
      .update(notificationUrl + body)
      .digest('base64')

    expect(
      verifySquareWebhookSignature({
        body: `${body} `,
        notificationUrl,
        signature,
        signatureKey,
      }),
    ).toBe(false)
  })
})

describe('Square completed payment parsing', () => {
  const completedEvent = {
    type: 'payment.updated',
    event_id: 'event-1',
    created_at: '2026-07-16T18:05:00.000Z',
    data: {
      object: {
        payment: {
          id: 'payment-1',
          order_id: 'order-1',
          status: 'COMPLETED',
          updated_at: '2026-07-16T18:04:59.000Z',
          amount_money: { amount: 32500, currency: 'USD' },
        },
      },
    },
  }

  it('extracts a completed payment and its order correlation', () => {
    expect(parseCompletedSquarePayment(completedEvent)).toEqual({
      amountCents: 32500,
      currency: 'USD',
      eventId: 'event-1',
      orderId: 'order-1',
      paidAt: '2026-07-16T18:04:59.000Z',
      paymentId: 'payment-1',
    })
  })

  it('ignores pending and unrelated events', () => {
    expect(
      parseCompletedSquarePayment({
        ...completedEvent,
        data: {
          object: {
            payment: {
              ...completedEvent.data.object.payment,
              status: 'PENDING',
            },
          },
        },
      }),
    ).toBeNull()
    expect(
      parseCompletedSquarePayment({
        ...completedEvent,
        type: 'refund.updated',
      }),
    ).toBeNull()
  })
})

describe('Square Telegram confirmation', () => {
  it('includes the customer, invoice, amount, and Sightings link', () => {
    const message = buildSquarePaymentTelegramMessage({
      amountCents: 32500,
      customerName: 'Tamara Jarka',
      invoiceNumber: 18209,
      invoiceUrl:
        'https://sightings.sasquatchcarpet.com/admin/operations/invoices/invoice-1',
      paidAt: '2026-07-16T18:04:59.000Z',
    })

    expect(message).toContain('SQUARE PAYMENT RECEIVED')
    expect(message).toContain('Tamara Jarka')
    expect(message).toContain('Invoice #18209')
    expect(message).toContain('$325.00')
    expect(message).toContain('/admin/operations/invoices/invoice-1')
  })
})
