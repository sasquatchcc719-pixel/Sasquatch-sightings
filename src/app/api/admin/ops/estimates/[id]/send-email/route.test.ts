// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  send: vi.fn(),
  blacklist: vi.fn(),
  token: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklist }))
vi.mock('@/lib/ops/communications', () => ({
  buildEmailHtml: (text: string) => text,
}))
vi.mock('@/lib/ops/estimate-decision-token', () => ({
  createEstimateDecisionToken: mocks.token,
  buildEstimateDecisionUrl: () => 'https://example.com/estimate/token',
}))
import { POST } from './route'

const context = { params: Promise.resolve({ id: 'estimate-a' }) }
const request = (extra: Record<string, unknown> = {}) =>
  new NextRequest('https://example.com/api/send-email', {
    method: 'POST',
    body: JSON.stringify({ type: 'quote', ...extra }),
  })
let current: Record<string, unknown>
let updated: { id: string } | null
let update: ReturnType<typeof vi.fn>
let emailLog: ReturnType<typeof vi.fn>
let audit: ReturnType<typeof vi.fn>
let filters: unknown[][]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  mocks.access.mockResolvedValue({ id: 'staff-a' })
  mocks.blacklist.mockResolvedValue(false)
  mocks.send.mockResolvedValue({ data: { id: 'email-a' }, error: null })
  mocks.token.mockReturnValue('token')
  current = {
    id: 'estimate-a',
    estimate_status: 'accepted',
    converted_appointment_id: null,
    quoted_total: 1049.94,
    appointment_date: '2026-09-04',
    start_time: '10:00',
    end_time: '12:00',
    ops_customers: {
      id: 'customer-a',
      first_name: 'Customer',
      email: 'customer@example.com',
      phone: '7195550123',
    },
    ops_appointment_line_items: [
      {
        name_snapshot: 'Commercial carpet cleaning',
        quantity: 2258,
        unit_price: 0.4,
        line_total: 903.2,
        pricing_unit_snapshot: 'per_sq_ft',
        notes: 'Initial deep clean',
      },
    ],
  }
  updated = { id: 'estimate-a' }
  filters = []
  emailLog = vi.fn().mockResolvedValue({ error: null })
  audit = vi.fn().mockResolvedValue({ error: null })
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((...args: unknown[]) => {
      filters.push(args)
      return builder
    }),
    is: vi.fn((...args: unknown[]) => {
      filters.push(args)
      return builder
    }),
    single: vi.fn(async () => ({ data: current, error: null })),
    maybeSingle: vi.fn(async () => ({ data: updated, error: null })),
    update: vi.fn().mockReturnThis(),
  }
  update = builder.update
  mocks.db.mockReturnValue({
    from: (table: string) =>
      table === 'ops_email_log'
        ? { insert: emailLog }
        : table === 'ops_appointment_status_events'
          ? { insert: audit }
          : builder,
  })
})

describe('manual estimate resend', () => {
  it('requires an authorized session', async () => {
    mocks.access.mockRejectedValue(new Error('Not authorized'))
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it.each(['accepted', 'declined'])(
    'never silently reopens a %s estimate',
    async (status) => {
      current.estimate_status = status
      expect((await POST(request(), context)).status).toBe(409)
      expect(mocks.send).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    },
  )
  it('requires a reason for reopening', async () => {
    expect(
      (await POST(request({ reopen: true, reason: '  ' }), context)).status,
    ).toBe(400)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('reopens explicitly, preserves the quote, and records staff and reason', async () => {
    const response = await POST(
      request({ reopen: true, reason: 'Customer disputes approval' }),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      to_email: 'customer@example.com',
      warning: null,
    })
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      to: 'customer@example.com',
      html: expect.stringContaining('2258 sqft × $0.40 = $903.20'),
    })
    expect(mocks.send.mock.calls[0][0].html).toContain(
      'Estimated Total: $1049.94',
    )
    expect(emailLog).toHaveBeenCalledWith(
      expect.objectContaining({ resend_id: 'email-a' }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ estimate_status: 'sent' }),
    )
    expect(filters).toContainEqual(['estimate_status', 'accepted'])
    expect(filters).toContainEqual(['converted_appointment_id', null])
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        from_status: 'accepted',
        to_status: 'sent',
        changed_by: 'staff-a',
        notes: expect.stringContaining('Customer disputes approval'),
      }),
    )
  })
  it.each(['draft', 'sent'])(
    'sends a %s estimate without requiring a reopen reason',
    async (status) => {
      current.estimate_status = status
      expect((await POST(request(), context)).status).toBe(200)
      expect(mocks.send).toHaveBeenCalledOnce()
    },
  )
  it.each([
    { converted_appointment_id: 'job-a' },
    { estimate_status: 'converted' },
  ])('blocks converted estimates', async (value) => {
    Object.assign(current, value)
    expect(
      (await POST(request({ reopen: true, reason: 'Disputed' }), context))
        .status,
    ).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('refuses an email address different from the confirmation', async () => {
    current.estimate_status = 'sent'
    expect(
      (await POST(request({ expected_email: 'other@example.com' }), context))
        .status,
    ).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not reset the decision or record a send when the provider rejects it', async () => {
    mocks.send.mockResolvedValue({ error: { message: 'Rejected' }, data: null })
    expect(
      (await POST(request({ reopen: true, reason: 'Disputed' }), context))
        .status,
    ).toBe(500)
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(emailLog).not.toHaveBeenCalled()
  })
  it('does not overwrite a concurrent customer decision and warns after sending', async () => {
    updated = null
    const response = await POST(
      request({ reopen: true, reason: 'Disputed' }),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      warning: expect.stringContaining('status'),
    })
    expect(audit).not.toHaveBeenCalled()
  })
  it('reports a sent email with a history warning, not a retry-inducing send failure', async () => {
    emailLog.mockResolvedValue({ error: { message: 'DB unavailable' } })
    const response = await POST(
      request({ reopen: true, reason: 'Disputed' }),
      context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      warning: expect.stringContaining('history'),
    })
  })
  it('keeps retries on the same provider key and the same link expiration', async () => {
    current.estimate_status = 'sent'
    const requestId = `${Date.now()}-01234567-89ab-4cde-8fab-0123456789ab`
    await POST(request({ request_id: requestId }), context)
    await POST(request({ request_id: requestId }), context)
    expect(mocks.send.mock.calls[0][1]).toEqual({
      idempotencyKey: `estimate-quote/estimate-a/${requestId}`,
    })
    expect(mocks.token.mock.calls[0][0]).toEqual(mocks.token.mock.calls[1][0])
  })
})
