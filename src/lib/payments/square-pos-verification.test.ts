// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSquarePosContext,
  verifySquarePosContext,
  verifySquarePosPayment,
  squarePosNote,
} from './square-pos-verification'

const input = {
  purpose: 'restoration' as const,
  appointmentId: 'visit-1',
  amountCents: 10000,
  kind: 'deposit' as const,
  returnTo: '/admin/operations/restoration/project-1',
  actorId: 'owner-1',
}
beforeEach(() => {
  vi.stubEnv('PAYMENT_LINK_SIGNING_SECRET', 'test-signing-key')
  vi.stubEnv('SQUARE_ACCESS_TOKEN', 'test-square-token')
  vi.stubEnv('SQUARE_LOCATION_ID', 'location-1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function provider(context: ReturnType<typeof verifySquarePosContext>) {
  return {
    order: {
      id: 'order-1',
      location_id: 'location-1',
      state: 'COMPLETED',
      line_items: [{ note: squarePosNote(context) }],
      tenders: [{ payment_id: 'payment-1' }],
    },
    payment: {
      id: 'payment-1',
      order_id: 'order-1',
      location_id: 'location-1',
      status: 'COMPLETED',
      source_type: 'CARD',
      amount_money: { amount: 10000, currency: 'USD' },
      created_at: '2026-10-28T14:00:00Z',
    },
  }
}
function mockProvider(data: ReturnType<typeof provider>) {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ order: data.order }))
    .mockResolvedValueOnce(Response.json({ payment: data.payment }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('Square POS trust boundary', () => {
  it('refuses unsafe amounts before a charge can be launched', () => {
    expect(() =>
      createSquarePosContext({ ...input, amountCents: 1e30 }),
    ).toThrow()
  })
  it('binds amount, appointment, actor, kind, return path and unique provider note in signed state', () => {
    const launch = createSquarePosContext(input)
    expect(verifySquarePosContext(launch.state)).toMatchObject(input)
    expect(launch.note).toContain('visit-1')
    expect(createSquarePosContext(input).note).not.toBe(launch.note)
    const [payload, signature] = launch.state.split('.')
    const tampered = {
      ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
      amountCents: 1,
    }
    expect(() =>
      verifySquarePosContext(
        `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`,
      ),
    ).toThrow()
    expect(() =>
      verifySquarePosContext(JSON.stringify({ a: 'visit-1', c: 1 })),
    ).toThrow()
  })
  it('preserves the invoice number for existing webhook matching and binds invoice identity', () => {
    const launch = createSquarePosContext({
      ...input,
      purpose: 'invoice',
      kind: 'payment',
      invoiceId: 'invoice-1',
      invoiceNumber: 12345,
    })
    expect(launch.note).toMatch(/^Invoice #12345 · Sightings invoice payment /)
    expect(verifySquarePosContext(launch.state)).toMatchObject({
      purpose: 'invoice',
      invoiceId: 'invoice-1',
      invoiceNumber: 12345,
    })
  })
  it('accepts an exact request note on the retrieved payment when absent on the order', async () => {
    const context = verifySquarePosContext(createSquarePosContext(input).state)
    const data = provider(context)
    data.order.line_items = []
    Object.assign(data.payment, { note: squarePosNote(context) })
    mockProvider(data)
    expect((await verifySquarePosPayment('order-1', context)).paymentId).toBe(
      'payment-1',
    )
  })
  it('rejects expired launches', () => {
    vi.useFakeTimers()
    const launch = createSquarePosContext(input)
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1)
    expect(() => verifySquarePosContext(launch.state)).toThrow(/expired/)
  })
  it('gets order then completed card payment with authenticated read-only requests', async () => {
    const context = verifySquarePosContext(createSquarePosContext(input).state)
    const fetch = mockProvider(provider(context))
    expect(await verifySquarePosPayment('order-1', context)).toEqual({
      paymentId: 'payment-1',
      orderId: 'order-1',
      amountCents: 10000,
      paidAt: '2026-10-28T14:00:00Z',
    })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://connect.squareup.com/v2/orders/order-1',
      'https://connect.squareup.com/v2/payments/payment-1',
    ])
    expect(
      fetch.mock.calls.every(
        ([, options]) => !options.method && options.cache === 'no-store',
      ),
    ).toBe(true)
  })
  it.each(['wrong_location', 'split_tender'])(
    'rejects %s before reading a payment',
    async (failure) => {
      const context = verifySquarePosContext(
        createSquarePosContext(input).state,
      )
      const data = provider(context)
      if (failure === 'unrelated_note')
        data.order.line_items[0].note = 'unrelated sale'
      if (failure === 'wrong_location')
        data.order.location_id = 'other-location'
      if (failure === 'split_tender')
        data.order.tenders.push({ payment_id: 'payment-2' })
      const fetch = mockProvider(data)
      await expect(verifySquarePosPayment('order-1', context)).rejects.toThrow()
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    'unrelated_note',
    'wrong_amount',
    'wrong_currency',
    'pending',
    'wrong_order',
    'cash',
    'refunded',
  ])('rejects provider payment %s', async (failure) => {
    const context = verifySquarePosContext(createSquarePosContext(input).state)
    const data = provider(context)
    if (failure === 'unrelated_note')
      data.order.line_items[0].note = 'unrelated sale'
    if (failure === 'wrong_amount') data.payment.amount_money.amount = 10001
    if (failure === 'wrong_currency') data.payment.amount_money.currency = 'CAD'
    if (failure === 'pending') data.payment.status = 'APPROVED'
    if (failure === 'wrong_order') data.payment.order_id = 'other-order'
    if (failure === 'cash') data.payment.source_type = 'CASH'
    if (failure === 'refunded')
      Object.assign(data.payment, { refunded_money: { amount: 100 } })
    mockProvider(data)
    await expect(verifySquarePosPayment('order-1', context)).rejects.toThrow()
  })
  it('fails closed on missing credentials or provider errors', async () => {
    const context = verifySquarePosContext(createSquarePosContext(input).state)
    vi.stubEnv('SQUARE_LOCATION_ID', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(verifySquarePosPayment('order-1', context)).rejects.toThrow(
      /configured/,
    )
    expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('SQUARE_LOCATION_ID', 'location-1')
    fetch.mockResolvedValue(new Response('', { status: 503 }))
    await expect(verifySquarePosPayment('order-1', context)).rejects.toThrow(
      /verify/,
    )
  })
})
