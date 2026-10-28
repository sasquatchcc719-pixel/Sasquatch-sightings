// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  admin: vi.fn(),
  log: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: mocks.validate,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/twilio/call-history', () => ({ writeCallLog: mocks.log }))
import { POST } from './route'
function request() {
  return new NextRequest('https://example.test/api/twilio/call-after-hours', {
    method: 'POST',
    body: new URLSearchParams({
      From: '+17195550123',
      CallSid: 'call-1',
      DialCallStatus: 'completed',
      AccountSid: 'account-1',
    }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.validate.mockReturnValue(false)
  mocks.admin.mockReturnValue({})
})
describe('after-hours inbound authentication', () => {
  it('rejects forged callbacks before creating a database client or logging a call', async () => {
    expect((await POST(request())).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.log).not.toHaveBeenCalled()
  })
  it('preserves a validated completed-call response', async () => {
    mocks.validate.mockReturnValue(true)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<Hangup/>')
    expect(mocks.log).toHaveBeenCalled()
  })
})
