// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ auth: vi.fn(), bind: vi.fn(), config: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: m.auth,
}))
vi.mock('@/lib/twilio/appointment-queue', () => ({
  bindQueueWorker: m.bind,
  queueBaseUrl: () => 'https://example.com',
}))
vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: m.config,
}))
import { POST } from './route'
const callSid = `CA${'1'.repeat(32)}`
function request(From = '+12125550123') {
  return new NextRequest(
    'https://example.com/api/twilio/appointment-forward?token=11111111-1111-4111-8111-111111111111',
    {
      method: 'POST',
      body: new URLSearchParams({ CallSid: callSid, From }),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  m.auth.mockReturnValue(true)
  m.bind.mockResolvedValue(true)
  m.config.mockResolvedValue({
    primaryForwardNumber: '+17205550100',
    ivrScheduleTimeoutSeconds: 60,
  })
})
describe('queued caller forwarding', () => {
  it('dials staff from the original caller number without creating a business-number call', async () => {
    const response = await POST(request())
    const xml = await response.text()
    expect(response.status).toBe(200)
    expect(xml).toContain('callerId="+12125550123"')
    expect(xml).toContain('>+17205550100</Number>')
    expect(xml).toContain(`/call-accept?parent=${callSid}`)
    expect(xml).not.toContain('<Gather')
    expect(xml).not.toContain('<Queue')
    expect(xml).not.toContain('Press 1')
  })
  it('rejects forged dequeue callbacks before accessing settings', async () => {
    m.auth.mockReturnValue(false)
    expect((await POST(request())).status).toBe(403)
    expect(m.bind).not.toHaveBeenCalled()
    expect(m.config).not.toHaveBeenCalled()
  })
  it('never forwards a stale dispatch attempt', async () => {
    m.bind.mockResolvedValue(false)
    expect(await (await POST(request())).text()).toContain('<Hangup/>')
    expect(m.config).not.toHaveBeenCalled()
  })
})
