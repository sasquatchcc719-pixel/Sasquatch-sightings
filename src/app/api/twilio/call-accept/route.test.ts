import { NextRequest } from 'next/server'
import twilio from 'twilio'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const { db, update, select } = vi.hoisted(() => ({
  db: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: db }))
import { POST } from './route'
const parent = `CA${'1'.repeat(32)}`
const child = `CA${'2'.repeat(32)}`
const account = `AC${'3'.repeat(32)}`
function request(
  digits?: string,
  attempt = false,
  signed = true,
  bound = true,
) {
  const url = `https://sightings.sasquatchcarpet.com/api/twilio/call-accept?parent=${parent}${attempt ? '&attempt=1' : ''}`
  const form: Record<string, string> = {
    CallSid: child,
    ParentCallSid: bound ? parent : `CA${'4'.repeat(32)}`,
    AccountSid: account,
  }
  if (digits !== undefined) form.Digits = digits
  return new NextRequest(url, {
    method: 'POST',
    body: new URLSearchParams(form),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signed
        ? twilio.getExpectedTwilioSignature('test-token', url, form)
        : 'forged',
    },
  })
}
describe('receiving phone acceptance', () => {
  beforeEach(() => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', account)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    vi.stubEnv(
      'TWILIO_WEBHOOK_BASE_URL',
      'https://sightings.sasquatchcarpet.com',
    )
    const q = { update, eq: vi.fn().mockReturnThis(), select }
    update.mockReset().mockReturnValue(q)
    select
      .mockReset()
      .mockResolvedValue({ data: [{ call_sid: parent }], error: null })
    db.mockReturnValue({ from: vi.fn(() => q) })
  })
  afterEach(() => vi.unstubAllEnvs())
  it('connects on answer without a receiver keypress', async () => {
    const xml = await (await POST(request())).text()
    expect(xml).toBe('<Response></Response>')
    expect(xml).not.toContain('<Gather')
    expect(update).toHaveBeenCalled()
  })
  it('records the answered forwarding leg before bridging', async () => {
    const xml = await (await POST(request('1', true))).text()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        forwarding_required: true,
        forwarding_accepted_at: expect.any(String),
      }),
    )
    expect(xml).toBe('<Response></Response>')
    expect(xml).not.toContain('<Hangup')
  })
  it('does not require digits even on a legacy attempt callback', async () => {
    expect(await (await POST(request('', true))).text()).toBe(
      '<Response></Response>',
    )
    expect(update).toHaveBeenCalled()
  })
  it('rejects a forged acceptance', async () => {
    expect((await POST(request('1', true, false))).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects a mismatched parent', async () => {
    expect((await POST(request('1', true, true, false))).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })
  it('still bridges an answered call if the database is unavailable', async () => {
    select.mockResolvedValue({ data: null, error: new Error('DB unavailable') })
    expect(await (await POST(request('1', true))).text()).toBe(
      '<Response></Response>',
    )
  })
})
