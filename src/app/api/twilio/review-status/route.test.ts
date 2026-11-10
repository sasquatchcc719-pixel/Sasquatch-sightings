// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import twilio from 'twilio'
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
import { POST } from './route'
const requestId = '20000000-0000-4000-8000-000000000001'
const sid = 'SM' + '1'.repeat(32)
const token = 'offline-test-token'
const account = 'AC' + '2'.repeat(32)
const url = `https://sightings.sasquatchcarpet.com/api/twilio/review-status?request=${requestId}`
function request(
  overrides: Record<string, string> = {},
  signed = true,
  target = url,
) {
  const form = {
    AccountSid: account,
    MessageSid: sid,
    MessageStatus: 'delivered',
    ...overrides,
  }
  return new NextRequest(target, {
    method: 'POST',
    body: new URLSearchParams(form),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed
        ? twilio.getExpectedTwilioSignature(token, url, form)
        : 'invalid',
    },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TWILIO_AUTH_TOKEN', token)
  vi.stubEnv('TWILIO_ACCOUNT_SID', account)
  vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', 'https://sightings.sasquatchcarpet.com')
  mocks.rpc.mockResolvedValue({ data: true, error: null })
})
afterEach(() => vi.unstubAllEnvs())
describe('review delivery callbacks', () => {
  it('rejects an unsigned callback without touching the database', async () => {
    expect((await POST(request({}, false))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires the configured Twilio account even with a matching signature', async () => {
    expect((await POST(request({ AccountSid: 'wrong-account' }))).status).toBe(
      403,
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('binds the signature to the request ID in the callback URL', async () => {
    expect(
      (
        await POST(
          request(
            {},
            true,
            url.replace(requestId, '30000000-0000-4000-8000-000000000001'),
          ),
        )
      ).status,
    ).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('validates the fixed sender URL rather than an unrelated site base setting', async () => {
    vi.stubEnv('TWILIO_WEBHOOK_BASE_URL', 'https://unrelated.example')
    expect((await POST(request())).status).toBe(204)
  })
  it('records actual signed delivery evidence and never replies to the customer', async () => {
    expect((await POST(request())).status).toBe(204)
    expect(mocks.rpc).toHaveBeenCalledWith('record_review_request_delivery', {
      p_request: requestId,
      p_sid: sid,
      p_status: 'delivered',
      p_error_code: null,
      p_is_callback: true,
    })
  })
  it('records signed delivery failure and the provider error code', async () => {
    expect(
      (
        await POST(
          request({ MessageStatus: 'undelivered', ErrorCode: '30003' }),
        )
      ).status,
    ).toBe(204)
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_status: 'undelivered',
      p_error_code: '30003',
    })
  })
  it.each([
    { MessageSid: 'bad' },
    { MessageStatus: 'invented' },
    { ErrorCode: 'unsafe text' },
  ])('rejects invalid provider fields', async (fields) => {
    expect((await POST(request(fields))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns a retryable error when persistence is uncertain', async () => {
    mocks.rpc.mockResolvedValue({ error: new Error('unavailable') })
    expect((await POST(request())).status).toBe(503)
  })
})
