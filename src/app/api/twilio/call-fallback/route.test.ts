import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  blocked: vi.fn(),
  admin: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: mocks.auth,
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: mocks.blocked }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
import { POST } from './route'
function request() {
  return new NextRequest(
    'https://sightings.sasquatchcarpet.com/api/twilio/call-fallback',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ CallSid: 'CA123', From: '+17195550123' }),
    },
  )
}
describe('fallback caller screening', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockReturnValue(true)
    mocks.blocked.mockResolvedValue(false)
    mocks.admin.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })),
    })
  })
  it('preserves the anti-spam menu even when the primary router fails', async () => {
    const xml = await (await POST(request())).text()
    expect(xml).toContain('<Gather')
    expect(xml).toContain('press 1.')
    expect(xml).toContain('press 2.')
    expect(xml).not.toContain('<Dial')
  })
  it('rejects forged fallback calls', async () => {
    mocks.auth.mockReturnValue(false)
    expect((await POST(request())).status).toBe(403)
  })
  it('keeps an explicitly blacklisted caller blocked', async () => {
    mocks.blocked.mockResolvedValue(true)
    expect(await (await POST(request())).text()).toContain('<Reject/>')
  })
})
