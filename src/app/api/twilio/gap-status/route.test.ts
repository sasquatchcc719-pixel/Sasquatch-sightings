// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ validate: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: mocks.validate,
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
import { POST } from './route'
const recipient = '30000000-0000-4000-8000-000000000001',
  sid = 'SM' + '1'.repeat(32)
function request() {
  return new NextRequest(
    `https://sightings.sasquatchcarpet.com/api/twilio/gap-status?recipient=${recipient}`,
    {
      method: 'POST',
      body: new URLSearchParams({
        AccountSid: 'test-account',
        MessageSid: sid,
        MessageStatus: 'delivered',
      }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.validate.mockReturnValue(true)
  mocks.rpc.mockResolvedValue({ error: null })
})
describe('authenticated delivery evidence', () => {
  it('rejects unsigned callbacks before touching records', async () => {
    mocks.validate.mockReturnValue(false)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('records a signed callback and acknowledges without replying', async () => {
    expect((await POST(request())).status).toBe(204)
    expect(mocks.rpc).toHaveBeenCalledWith('record_gap_outreach_delivery', {
      p_recipient: recipient,
      p_sid: sid,
      p_status: 'delivered',
    })
  })
  it('asks the provider to retry uncertain persistence instead of reporting success', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'db offline' } })
    expect((await POST(request())).status).toBe(503)
  })
})
