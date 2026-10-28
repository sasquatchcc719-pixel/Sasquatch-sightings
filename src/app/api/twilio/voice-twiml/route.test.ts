// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const validate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: validate,
}))
import { POST } from './route'
function request(to: string) {
  return new NextRequest('https://example.test/api/twilio/voice-twiml', {
    method: 'POST',
    body: new URLSearchParams({ To: to, AccountSid: 'account-1' }),
  })
}
beforeEach(() => validate.mockReset())
describe('outbound voice TwiML trust boundary', () => {
  it('fails closed for unverified callbacks', async () => {
    validate.mockReturnValue(false)
    expect((await POST(request('+17195550123'))).status).toBe(403)
  })
  it('preserves validated normal phone dialing', async () => {
    validate.mockReturnValue(true)
    const response = await POST(request('7195550123'))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<Number>+17195550123</Number>')
  })
  it('rejects TwiML injection in client-supplied destination parameters', async () => {
    validate.mockReturnValue(true)
    expect(
      (await POST(request('+17195550123</Number><Number>+19005550123'))).status,
    ).toBe(400)
  })
})
