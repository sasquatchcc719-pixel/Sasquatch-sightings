import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PaymentLinkTokenError,
  buildPublicPaymentUrl,
  createInvoicePaymentToken,
  verifyInvoicePaymentToken,
} from './signed-payment-link'

describe('signed invoice payment links', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips invoice payment metadata', () => {
    vi.stubEnv('PAYMENT_LINK_SIGNING_SECRET', 'test-secret')
    const expiresAt = new Date('2026-08-01T00:00:00.000Z')

    const token = createInvoicePaymentToken({
      invoiceId: 'invoice-id',
      provider: 'square',
      expiresAt,
    })

    expect(
      verifyInvoicePaymentToken(token, new Date('2026-07-01T00:00:00.000Z')),
    ).toEqual({
      invoiceId: 'invoice-id',
      provider: 'square',
      expiresAt,
    })
  })

  it('rejects tampered tokens', () => {
    vi.stubEnv('PAYMENT_LINK_SIGNING_SECRET', 'test-secret')
    const token = createInvoicePaymentToken({
      invoiceId: 'invoice-id',
      provider: 'venmo',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    const [payload, signature] = token.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        i: 'different-invoice',
        p: 'venmo',
        exp: 1785542400,
      }),
    ).toString('base64url')

    expect(() =>
      verifyInvoicePaymentToken(
        `${tamperedPayload}.${signature}`,
        new Date('2026-07-01T00:00:00.000Z'),
      ),
    ).toThrow(PaymentLinkTokenError)
    expect(payload).not.toBe(tamperedPayload)
  })

  it('rejects expired tokens', () => {
    vi.stubEnv('PAYMENT_LINK_SIGNING_SECRET', 'test-secret')
    const token = createInvoicePaymentToken({
      invoiceId: 'invoice-id',
      provider: 'square',
      expiresAt: new Date('2026-07-01T00:00:00.000Z'),
    })

    expect(() =>
      verifyInvoicePaymentToken(token, new Date('2026-07-02T00:00:00.000Z')),
    ).toThrow(PaymentLinkTokenError)
  })

  it('builds a first-party pay URL', () => {
    expect(buildPublicPaymentUrl('https://example.com/', 'abc.def')).toBe(
      'https://example.com/pay/abc.def',
    )
  })
})
