import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reconcile, enqueue, enqueueEmail, db } = vi.hoisted(() => ({
  reconcile: vi.fn(),
  enqueue: vi.fn(),
  enqueueEmail: vi.fn(),
  db: {},
}))
vi.mock('@/lib/mcp/missed-call-events', () => ({
  enqueueMissedCallEvent: enqueue,
}))
vi.mock('@/lib/mcp/missed-call-email-bridge', () => ({
  enqueueMissedCallEmailBridge: enqueueEmail,
}))
vi.mock('@/lib/twilio/call-history', () => ({ reconcileEndedCall: reconcile }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => db }))
import { POST } from './route'

const account = `AC${'1'.repeat(32)}`
const sid = `CA${'2'.repeat(32)}`
const url = 'https://sightings.sasquatchcarpet.com/api/twilio/call-status'
function request(status = 'completed', signed = true) {
  const params = { AccountSid: account, CallSid: sid, CallStatus: status }
  return new NextRequest(url, {
    method: 'POST',
    body: new URLSearchParams(params),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed
        ? twilio.getExpectedTwilioSignature('test-token', url, params)
        : 'forged',
    },
  })
}
describe('call-ended callback', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', account)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    reconcile.mockReset().mockResolvedValue(undefined)
    enqueue.mockReset().mockResolvedValue(0)
    enqueueEmail.mockReset().mockResolvedValue(false)
  })
  afterEach(() => vi.unstubAllEnvs())
  it('rejects forged callbacks without reading or writing call history', async () => {
    expect((await POST(request('completed', false))).status).toBe(403)
    expect(reconcile).not.toHaveBeenCalled()
  })
  it('reconciles the parent using actual forwarding and recording evidence', async () => {
    expect((await POST(request())).status).toBe(204)
    expect(reconcile).toHaveBeenCalledWith(db, expect.anything(), sid)
  })
  it('enqueues only the finalized call returned by the authenticated live callback', async () => {
    const call = {
      callSid: sid,
      phone: '+17195550100',
      outcome: 'no-answer',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    }
    reconcile.mockResolvedValue(call)
    expect((await POST(request())).status).toBe(204)
    expect(enqueue).toHaveBeenCalledWith(db, call)
    expect(enqueueEmail).toHaveBeenCalledWith(db, call)
  })
  it('returns a retryable error if durably enqueueing fails', async () => {
    reconcile.mockResolvedValue({ callSid: sid })
    enqueue.mockRejectedValue(new Error('Outbox unavailable'))
    expect((await POST(request())).status).toBe(500)
  })
  it('does not finalize a call still in progress', async () => {
    expect((await POST(request('in-progress'))).status).toBe(204)
    expect(reconcile).not.toHaveBeenCalled()
  })
  it('returns a retryable error when the provider or database is unavailable', async () => {
    reconcile.mockRejectedValue(new Error('Temporary outage'))
    expect((await POST(request())).status).toBe(500)
  })
})
