// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  twilio: vi.fn(),
  check: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('twilio', () => ({ default: mocks.twilio }))
vi.mock('@/lib/twilio/phone-health', () => ({
  runPhoneHealthCheck: mocks.check,
}))
import { GET } from './route'
function request(authorized = true) {
  return new NextRequest('https://example.test/api/cron/phone-health', {
    headers: authorized ? { authorization: 'Bearer test-secret' } : {},
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'test-sid')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+17192498791')
})
afterEach(() => vi.unstubAllEnvs())
describe('phone health cron authorization and failure status', () => {
  it('rejects unauthenticated requests before touching providers', async () => {
    expect((await GET(request(false))).status).toBe(401)
    expect(mocks.twilio).not.toHaveBeenCalled()
  })
  it('requires a configured cron secret', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request())).status).toBe(401)
  })
  it('fails visibly if provider credentials are missing', async () => {
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    expect((await GET(request())).status).toBe(503)
    expect(mocks.check).not.toHaveBeenCalled()
  })
  it('returns a checked summary', async () => {
    mocks.check.mockResolvedValue({ callsChecked: 3, errors: [] })
    const res = await GET(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ callsChecked: 3, errors: [] })
  })
  it('returns failure for provider or notification errors recorded in summary', async () => {
    mocks.check.mockResolvedValue({
      callsChecked: 0,
      errors: ['Provider unavailable'],
    })
    expect((await GET(request())).status).toBe(500)
  })
})
