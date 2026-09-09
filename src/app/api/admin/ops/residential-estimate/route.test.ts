// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  send: vi.fn(),
  blacklist: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))
vi.mock('@/lib/ops/communications', () => ({
  buildEmailHtml: (body: string) => `<html>${body}</html>`,
}))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))
import { POST } from './route'

const base = {
  action: 'preview',
  recipient_email: 'neighbor@example.com',
  line_items: [
    { name_snapshot: 'Carpet cleaning', quantity: 3, unit_price: 50 },
  ],
}
const newRequestId = () => `${Date.now()}-01234567-89ab-4cde-8fab-0123456789ab`
const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest('https://example.com/api/admin/ops/residential-estimate', {
    method: 'POST',
    body: JSON.stringify({ ...base, ...extra }),
  })
let tables: string[]
let services: Record<string, unknown>[]
let recipientCustomers: Record<string, unknown>[]
let selectedCustomer: Record<string, unknown> | null
let promo: Record<string, unknown> | null
let tiers: Record<string, number>[]
let log: ReturnType<typeof vi.fn>
let savedLogs: Map<string, Record<string, unknown>>
let receiptError: { message: string } | null

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  vi.stubEnv('OPS_EMAIL_BCC', 'shop@example.com\n')
  mocks.access.mockResolvedValue({ id: 'staff-a' })
  mocks.blacklist.mockResolvedValue(false)
  mocks.send.mockResolvedValue({ data: { id: 'email-a' }, error: null })
  tables = []
  services = []
  recipientCustomers = []
  selectedCustomer = null
  promo = null
  tiers = []
  savedLogs = new Map()
  receiptError = null
  log = vi.fn(async (record) => {
    savedLogs.set(record.id, record)
    return { error: null }
  })
  mocks.db.mockReturnValue({
    from: (table: string) => {
      tables.push(table)
      if (table === 'ops_email_log') {
        let receiptId = ''
        const builder = {
          upsert: log,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((field: string, value: string) => {
            if (field === 'id') receiptId = value
            return builder
          }),
          maybeSingle: vi.fn(async () => ({
            data: savedLogs.get(receiptId) || null,
            error: receiptError,
          })),
        }
        return builder
      }
      const data = () => {
        if (table === 'ops_customers') return recipientCustomers
        if (table === 'service_catalog_items') return services
        if (table === 'promo_code_tiers') return tiers
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: table === 'promo_codes' ? promo : selectedCustomer,
          error: null,
        })),
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: data(), error: null }).then(resolve),
      }
    },
  })
})

async function preview(extra: Record<string, unknown> = {}) {
  const response = await POST(request(extra))
  expect(response.status).toBe(200)
  return response.json()
}

async function send(extra: Record<string, unknown> = {}) {
  const draft = await preview(extra)
  return POST(
    request({
      ...extra,
      action: 'send',
      expected_fingerprint: draft.preview_fingerprint,
      request_id: newRequestId(),
    }),
  )
}

describe('email-only residential estimate', () => {
  it('previews with only an email and services, without scheduling or writes', async () => {
    const result = await preview()
    expect(result).toMatchObject({
      to_email: 'neighbor@example.com',
      subtotal: 150,
      discount_amount: 0,
      total: 150,
    })
    expect(result.body_text).toContain('Carpet cleaning: 3 × $50.00 = $150.00')
    expect(result.body_text).toContain(
      'This estimate does not reserve a date or time.',
    )
    expect(result.body_text).not.toContain('Service address:')
    expect(result.body_text).not.toMatch(
      /walk-through|accept this estimate|payment|visiting your property/i,
    )
    expect(mocks.send).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(tables).toEqual(['ops_customers'])
  })

  it('sends the reviewed email and logs it without an appointment or customer write', async () => {
    const response = await send({
      recipient_email: ' NEW@example.com ',
      customer: { first_name: 'Jamie' },
      address: {
        street_1: '123 Pine St',
        street_2: 'Unit 2',
        city: 'Colorado Springs',
        state: 'CO',
        zip_code: '80918',
      },
      discount_amount: 25,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      to_email: 'new@example.com',
      warning: null,
    })
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        bcc: 'shop@example.com',
        subject: 'Your Estimate from Sasquatch Carpet Cleaning',
        text: expect.stringContaining('Hi Jamie,'),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(
          'residential-estimate/staff-a/',
        ),
      }),
    )
    expect(mocks.send.mock.calls[0][0].text).toContain(
      'Service address: 123 Pine St, Unit 2, Colorado Springs, CO 80918',
    )
    expect(mocks.send.mock.calls[0][0].text).toContain(
      'Discount: −$25.00\nEstimated total: $125.00',
    )
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        appointment_id: null,
        customer_id: null,
        template_key: 'residential_estimate',
        to_email: 'new@example.com',
        resend_id: 'email-a',
      }),
      { onConflict: 'id', ignoreDuplicates: true },
    )
    expect(new Set(tables)).toEqual(new Set(['ops_customers', 'ops_email_log']))
  })

  it('uses catalog prices when omitted and preserves the Book Job price override', async () => {
    services = [
      {
        id: 'service-a',
        name: 'Large room',
        base_price: 75,
        pricing_unit: 'per_room',
      },
    ]
    const result = await preview({
      line_items: [
        { service_catalog_item_id: 'service-a', quantity: 2 },
        {
          service_catalog_item_id: 'service-a',
          name_snapshot: 'Adjusted room',
          quantity: 1,
          unit_price: 55,
        },
      ],
    })
    expect(result.total).toBe(205)
    expect(result.body_text).toContain('Large room: 2 × $75.00 = $150.00')
    expect(result.body_text).toContain('Adjusted room: 1 × $55.00 = $55.00')
  })

  it.each([
    { discount_type: 'flat', discount_amount: 20, expected: 130 },
    { discount_type: 'percent', discount_amount: 15, expected: 127.5 },
    { discount_type: 'tiered', discount_amount: 0, expected: 125 },
  ])(
    'matches the booking $discount_type coupon math without consuming it',
    async ({ expected, ...values }) => {
      promo = {
        id: 'promo-a',
        code: 'SAVE',
        expires_at: null,
        max_uses: null,
        use_count: 1,
        ...values,
      }
      tiers = [
        { min_spend: 100, discount_amount: 25 },
        { min_spend: 200, discount_amount: 50 },
      ]
      const draft = await preview({ promo_code: 'save', discount_amount: 99 })
      expect(draft.total).toBe(expected)
      expect(draft.body_text).toContain('Discount (SAVE):')
      expect(tables).not.toContain('ops_invoices')
      expect(log).not.toHaveBeenCalled()
    },
  )

  it('caps a manual discount at the subtotal', async () => {
    expect(await preview({ discount_amount: 500 })).toMatchObject({
      discount_amount: 150,
      total: 0,
    })
  })

  it.each([
    { expires_at: '2000-01-01' },
    { max_uses: 1, use_count: 1 },
    { discount_type: 'tiered' },
  ])('refuses unavailable coupons: %j', async (values) => {
    promo = {
      id: 'promo-a',
      code: 'SAVE',
      discount_type: 'flat',
      discount_amount: 25,
      expires_at: null,
      max_uses: null,
      use_count: 0,
      ...values,
    }
    expect((await POST(request({ promo_code: 'SAVE' }))).status).toBe(400)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it.each([
    { recipient_email: 'invalid' },
    { recipient_email: 'customer@import.local' },
    { line_items: [] },
    { line_items: [{ name_snapshot: 'Carpet', quantity: -1, unit_price: 50 }] },
    { line_items: [{ name_snapshot: 'Carpet', quantity: 1, unit_price: -50 }] },
    { line_items: [{ name_snapshot: 'Carpet', quantity: 1, unit_price: '' }] },
    { discount_amount: 'NaN' },
  ])('rejects invalid quote data: %j', async (extra) => {
    expect((await POST(request(extra))).status).toBe(400)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('requires staff authorization', async () => {
    mocks.access.mockRejectedValue(new Error('Not authorized'))
    expect((await POST(request())).status).toBe(401)
    expect(tables).toEqual([])
  })

  it('honors a recipient opt-out even with no selected customer', async () => {
    recipientCustomers = [{ id: 'customer-a', email_opt_out: true }]
    expect((await POST(request())).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('honors the selected customer suppression when the recipient is overridden', async () => {
    selectedCustomer = { id: 'customer-a', phone: '7195550123' }
    mocks.blacklist.mockResolvedValue(true)
    expect((await POST(request({ customer_id: 'customer-a' }))).status).toBe(
      409,
    )
    expect(mocks.blacklist).toHaveBeenCalledWith('7195550123')
  })

  it('rejects a changed recipient or changed pricing after preview', async () => {
    const draft = await preview()
    for (const changed of [
      { recipient_email: 'other@example.com' },
      { discount_amount: 25 },
    ]) {
      const response = await POST(
        request({
          action: 'send',
          expected_fingerprint: draft.preview_fingerprint,
          request_id: newRequestId(),
          ...changed,
        }),
      )
      expect(response.status).toBe(409)
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('rechecks coupon changes against the preview', async () => {
    promo = {
      id: 'promo-a',
      code: 'SAVE',
      discount_type: 'flat',
      discount_amount: 25,
      expires_at: null,
      max_uses: null,
      use_count: 0,
    }
    const draft = await preview({ promo_code: 'SAVE' })
    promo.discount_amount = 10
    expect(
      (
        await POST(
          request({
            action: 'send',
            promo_code: 'SAVE',
            expected_fingerprint: draft.preview_fingerprint,
            request_id: newRequestId(),
          }),
        )
      ).status,
    ).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('requires a current idempotency request ID for sending', async () => {
    const draft = await preview()
    for (const requestId of [
      undefined,
      `${Date.now() - 2 * 86400000}-01234567-89ab-4cde-8fab-0123456789ab`,
    ]) {
      const response = await POST(
        request({
          action: 'send',
          expected_fingerprint: draft.preview_fingerprint,
          request_id: requestId,
        }),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'request_expired' })
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('returns the saved receipt without a second send, log, or pricing lookup', async () => {
    const draft = await preview()
    const extra = {
      action: 'send',
      expected_fingerprint: draft.preview_fingerprint,
      request_id: newRequestId(),
    }
    expect((await POST(request(extra))).status).toBe(200)
    tables = []
    const response = await POST(request(extra))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      to_email: 'neighbor@example.com',
      warning: null,
    })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
    expect(tables).toEqual(['ops_email_log'])
  })

  it('recognizes a sent estimate even after its coupon and request window expire', async () => {
    promo = {
      id: 'promo-a',
      code: 'SAVE',
      discount_type: 'flat',
      discount_amount: 25,
      expires_at: null,
      max_uses: null,
      use_count: 0,
    }
    const draft = await preview({ promo_code: 'SAVE' })
    const extra = {
      action: 'send',
      promo_code: 'SAVE',
      expected_fingerprint: draft.preview_fingerprint,
      request_id: newRequestId(),
    }
    expect((await POST(request(extra))).status).toBe(200)
    promo.expires_at = '2000-01-01'
    tables = []
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400000)
    try {
      const response = await POST(request(extra))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        success: true,
        to_email: 'neighbor@example.com',
      })
      expect(mocks.send).toHaveBeenCalledOnce()
      expect(tables).toEqual(['ops_email_log'])
    } finally {
      now.mockRestore()
    }
  })

  it('rejects reusing a completed send ID for a different reviewed estimate', async () => {
    const draft = await preview()
    const requestId = newRequestId()
    expect(
      (
        await POST(
          request({
            action: 'send',
            expected_fingerprint: draft.preview_fingerprint,
            request_id: requestId,
          }),
        )
      ).status,
    ).toBe(200)
    const revised = await preview({ discount_amount: 25 })
    const response = await POST(
      request({
        action: 'send',
        discount_amount: 25,
        expected_fingerprint: revised.preview_fingerprint,
        request_id: requestId,
      }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'request_reused' })
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
  })

  it('keeps the same provider key and unique log ID when retrying a missing receipt', async () => {
    log.mockResolvedValue({ error: { message: 'Temporary database error' } })
    const draft = await preview()
    const extra = {
      action: 'send',
      expected_fingerprint: draft.preview_fingerprint,
      request_id: newRequestId(),
    }
    expect((await POST(request(extra))).status).toBe(200)
    expect((await POST(request(extra))).status).toBe(200)
    expect(mocks.send.mock.calls[0]).toEqual(mocks.send.mock.calls[1])
    expect(log.mock.calls[0]).toEqual(log.mock.calls[1])
  })

  it('does not send when the prior delivery lookup cannot be checked', async () => {
    receiptError = { message: 'Database unavailable' }
    expect((await send()).status).toBe(500)
    expect(mocks.send).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('does not log a successful send if the provider rejects it', async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: 'Rejected' } })
    expect((await send()).status).toBe(500)
    expect(log).not.toHaveBeenCalled()
  })

  it('does not claim success when the provider fails to return a delivery ID', async () => {
    mocks.send.mockResolvedValue({ data: null, error: null })
    expect((await send()).status).toBe(500)
    expect(log).not.toHaveBeenCalled()
  })

  it('reports a sent email with a warning if history fails, preventing a duplicate retry', async () => {
    log.mockResolvedValue({ error: { message: 'Database unavailable' } })
    const response = await send()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      warning: expect.stringContaining('Email was sent'),
    })
  })
})
