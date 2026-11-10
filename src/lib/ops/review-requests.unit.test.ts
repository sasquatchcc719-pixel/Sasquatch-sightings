// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  blacklisted: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({ sendCustomerSMSWithResult: mocks.send }))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blacklisted }))
vi.mock('@/lib/telegram', () => ({ sendTelegramNotification: mocks.notify }))
import {
  buildReviewRequestMessage,
  enqueueReviewRequests,
  isReviewSmsOptedOut,
  processDueReviewRequests,
} from './review-requests'

const customerId = '10000000-0000-4000-8000-000000000001'
const requestId = '20000000-0000-4000-8000-000000000001'
const sid = 'SM' + '1'.repeat(32)
const now = new Date('2026-11-10T18:00:00Z')
type Row = Record<string, unknown>

// Entirely in-memory Supabase stub, with compare-and-set evaluated at execution.
function fixture() {
  const tables: Record<string, Row[]> = {
    review_requests: [
      {
        id: requestId,
        customer_id: customerId,
        phone: '+17195550100',
        status: 'pending',
        scheduled_for: now.toISOString(),
        created_at: new Date().toISOString(),
        send_claimed_at: null,
        twilio_sid: null,
      },
    ],
    ops_customers: [
      {
        id: customerId,
        first_name: 'Test',
        full_name: 'Test Customer',
        phone: '(719) 555-0100',
        business_name: null,
      },
    ],
    sms_marketing_consents: [],
    gbp_reviews: [],
    conversations: [],
    ops_appointments: [],
  }
  const errors: Record<string, unknown> = {}
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
  const from = vi.fn((table: string) => {
    let action = 'select',
      payload: Row = {},
      single = false,
      limit = Infinity
    const filters: Array<(row: Row) => boolean> = []
    const query = {
      select: () => query,
      update: (data: Row) => {
        action = 'update'
        payload = data
        return query
      },
      insert: (data: Row) => {
        action = 'insert'
        payload = data
        return query
      },
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value)
        return query
      },
      is: (key: string, value: unknown) => {
        filters.push((row) => (row[key] ?? null) === value)
        return query
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]))
        return query
      },
      or: (value: string) => {
        filters.push((row) =>
          value.split(',').some((part) => {
            const [key, , val] = part.split('.')
            return row[key] === val
          }),
        )
        return query
      },
      gte: (key: string, value: string) => {
        filters.push((row) => String(row[key] || '') >= value)
        return query
      },
      lte: (key: string, value: string) => {
        filters.push((row) => String(row[key] || '') <= value)
        return query
      },
      order: () => query,
      limit: (value: number) => {
        limit = value
        return query
      },
      maybeSingle: () => {
        single = true
        return query
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (errors[table])
          return Promise.resolve(resolve({ data: null, error: errors[table] }))
        const rows = (tables[table] || [])
          .filter((row) => filters.every((filter) => filter(row)))
          .slice(0, limit)
        if (action === 'update')
          rows.forEach((row) => Object.assign(row, payload))
        if (action === 'insert') tables[table].push({ ...payload })
        // Snapshot, not references: two overlapping runners can select the same row.
        const data = rows.map((row) => ({ ...row }))
        return Promise.resolve(
          resolve({ data: single ? data[0] || null : data, error: null }),
        )
      },
    }
    return query
  })
  return { tables, errors, rpc, db: { from, rpc } as unknown as SupabaseClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.blacklisted.mockResolvedValue(false)
  mocks.send.mockResolvedValue({ sid })
  mocks.notify.mockResolvedValue(true)
})

describe('existing review SMS suppression and submission', () => {
  it('preserves the approved review message', () => {
    expect(
      buildReviewRequestMessage({ first_name: 'Test', full_name: null }),
    ).toBe(
      "Hi Test, it's Charles with Sasquatch Carpet Cleaning. Thanks for having us out! If you have a minute to share your experience, you can choose your preferred review site here. Mentioning what we cleaned and how it turned out really helps future customers: https://www.sasquatchcarpet.com/reviews",
    )
  })
  it.each([
    { customer_id: customerId, phone_normalized: '+17195550999' },
    { customer_id: 'different-customer', phone_normalized: '+17195550100' },
  ])('honors an opt-out by customer or normalized handset', async (consent) => {
    const f = fixture()
    f.tables.sms_marketing_consents.push({ ...consent, status: 'opted_out' })
    expect(await isReviewSmsOptedOut(f.db, customerId, '(719) 555-0100')).toBe(
      true,
    )
    expect(await processDueReviewRequests(f.db, { now })).toEqual({
      sent: 0,
      failed: 0,
      deferred: false,
    })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(f.tables.review_requests[0]).toMatchObject({
      status: 'skipped',
      skip_reason: 'SMS opted out at send time',
    })
  })
  it('does not add a new opt-in eligibility requirement', async () => {
    const f = fixture()
    expect(await isReviewSmsOptedOut(f.db, customerId, '+17195550100')).toBe(
      false,
    )
    await processDueReviewRequests(f.db, { now })
    expect(mocks.send).toHaveBeenCalledWith(
      '(719) 555-0100',
      expect.any(String),
      undefined,
      'review_request',
      undefined,
      { customerId, reviewRequestId: requestId },
    )
    expect(f.rpc).toHaveBeenCalledWith('record_review_request_delivery', {
      p_request: requestId,
      p_sid: sid,
      p_status: 'accepted',
      p_is_callback: false,
    })
    expect(mocks.notify.mock.calls[0][0]).toContain('accepted by SMS provider')
  })
  it('fails closed on unreadable consent and never automatically retries a claimed send', async () => {
    const f = fixture()
    f.errors.sms_marketing_consents = new Error('consent unavailable')
    expect(await processDueReviewRequests(f.db, { now })).toMatchObject({
      sent: 0,
      failed: 1,
    })
    delete f.errors.sms_marketing_consents
    await processDueReviewRequests(f.db, { now })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(f.tables.review_requests[0].send_claimed_at).toBeTruthy()
  })
  it('records opted-out appointments as skipped at enqueue', async () => {
    const f = fixture()
    f.tables.review_requests = []
    f.tables.ops_appointments = [
      {
        id: 'appointment',
        customer_id: customerId,
        completed_at: new Date().toISOString(),
        status: 'completed',
      },
    ]
    f.tables.sms_marketing_consents = [
      {
        customer_id: customerId,
        phone_normalized: '+17195550100',
        status: 'opted_out',
      },
    ]
    expect(await enqueueReviewRequests(f.db)).toEqual({ queued: 0, skipped: 1 })
    expect(f.tables.review_requests[0]).toMatchObject({
      status: 'skipped',
      skip_reason: 'SMS opted out',
    })
  })
  it('enqueues nothing when consent lookup fails', async () => {
    const f = fixture()
    f.tables.review_requests = []
    f.tables.ops_appointments = [
      {
        id: 'appointment',
        customer_id: customerId,
        completed_at: new Date().toISOString(),
        status: 'completed',
      },
    ]
    f.errors.sms_marketing_consents = new Error('consent unavailable')
    await expect(enqueueReviewRequests(f.db)).rejects.toThrow(
      'consent unavailable',
    )
    expect(f.tables.review_requests).toHaveLength(0)
  })
  it('only one overlapping runner claims and sends the pending request', async () => {
    const f = fixture()
    await Promise.all([
      processDueReviewRequests(f.db, { now }),
      processDueReviewRequests(f.db, { now }),
    ])
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('does not resend a stale claim or ambiguous provider timeout', async () => {
    const f = fixture()
    mocks.send.mockRejectedValue(new Error('timeout after submission'))
    await processDueReviewRequests(f.db, { now })
    await processDueReviewRequests(f.db, { now })
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(f.tables.review_requests[0]).toMatchObject({
      status: 'pending',
      twilio_sid: null,
    })
    expect(f.tables.review_requests[0].skip_reason).toContain(
      'outcome unconfirmed',
    )
  })
  it('retains the 180-day customer cooldown after an ambiguous timeout', async () => {
    const f = fixture()
    mocks.send.mockRejectedValue(new Error('timeout after submission'))
    await processDueReviewRequests(f.db, { now })
    f.tables.ops_appointments = [
      {
        id: 'another-appointment',
        customer_id: customerId,
        completed_at: new Date().toISOString(),
        status: 'completed',
      },
    ]
    expect(await enqueueReviewRequests(f.db)).toEqual({ queued: 0, skipped: 1 })
    expect(f.tables.review_requests[1]).toMatchObject({
      status: 'skipped',
      skip_reason: 'asked within last 180 days',
    })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('requires a real SID before recording provider acceptance', async () => {
    const f = fixture()
    mocks.send.mockResolvedValue(undefined)
    expect(await processDueReviewRequests(f.db, { now })).toMatchObject({
      sent: 0,
      failed: 1,
    })
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('preserves accepted SID if the primary tracking write fails, without a retry', async () => {
    const f = fixture()
    f.rpc.mockResolvedValue({ data: null, error: new Error('RPC unavailable') })
    expect(await processDueReviewRequests(f.db, { now })).toMatchObject({
      sent: 1,
      failed: 1,
    })
    expect(f.tables.review_requests[0]).toMatchObject({
      status: 'sent',
      delivery_status: 'accepted',
      twilio_sid: sid,
    })
    await processDueReviewRequests(f.db, { now })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('preserves the send window and batch limit', async () => {
    const f = fixture()
    expect(
      await processDueReviewRequests(f.db, {
        now: new Date('2026-11-10T03:00:00Z'),
      }),
    ).toMatchObject({ deferred: true })
    expect(mocks.send).not.toHaveBeenCalled()
    f.tables.review_requests = Array.from({ length: 11 }, (_, i) => ({
      ...f.tables.review_requests[0],
      id: String(i),
    }))
    await processDueReviewRequests(f.db, { now })
    expect(mocks.send).toHaveBeenCalledTimes(10)
  })
})
