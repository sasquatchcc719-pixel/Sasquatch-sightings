// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  signed: vi.fn(),
  access: vi.fn(),
  start: vi.fn(),
  append: vi.fn(),
  config: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: m.signed,
}))
vi.mock('@/lib/twilio/harry-access', () => ({
  getHarryAccess: m.access,
  isHarryMainNumber: (n: string) => n === '+15550000001',
}))
vi.mock('@/lib/twilio/appointment-queue', () => ({
  queueBaseUrl: () => 'https://example.com',
}))
vi.mock('@/lib/twilio/call-routing-config', () => ({
  getCallRoutingConfig: m.config,
}))
vi.mock('@/lib/twilio/phone-health', () => ({
  forwardingExpectedAt: () => true,
}))
vi.mock('@/lib/phone-assistant/records', () => ({
  beginVoiceSession: m.start,
  appendVoiceTranscript: m.append,
}))
import { POST } from './route'
const sid = 'CA' + 'b'.repeat(32)
const send = (step: string, fields: Record<string, string> = {}) =>
  POST(
    new NextRequest('https://example.com/api/twilio/harry-voice?step=' + step, {
      method: 'POST',
      body: new URLSearchParams({
        From: '+15550000123',
        To: '+15550000001',
        CallSid: sid,
        ...fields,
      }),
    }),
  )
beforeEach(() => {
  vi.resetAllMocks()
  m.signed.mockReturnValue(true)
  m.access.mockResolvedValue({ preview: true, publicEnabled: false })
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'test-key')
  vi.stubEnv('HARRY_VOICE_PROJECT_ID', 'proj_test')
})
afterEach(() => vi.unstubAllEnvs())
it('starts native SIP and both-track transcription for the authorized preview', async () => {
  const result = await (await send('start&preview=1')).text()
  expect(result).toContain('secure=true?X-Sightings-Invite=')
  expect(result).toContain('track="both_tracks"')
  expect(result).toContain('simulated')
  expect(m.start).toHaveBeenCalledWith({
    callSid: sid,
    callerPhone: '+15550000123',
    pilot: true,
  })
})
it('rejects forged requests, other dialed numbers, and unapproved caller IDs', async () => {
  m.signed.mockReturnValueOnce(false)
  expect((await send('start&preview=1')).status).toBe(403)
  expect((await send('start&preview=1', { To: '+15550000002' })).status).toBe(
    403,
  )
  m.access.mockResolvedValue({ preview: false, publicEnabled: false })
  expect(await (await send('start&preview=1')).text()).not.toContain('<Sip>')
  expect(await (await send('start')).text()).not.toContain('<Sip>')
  expect(m.start).not.toHaveBeenCalled()
})
it('keeps a failed pilot connection isolated from staff and missed-call SMS', async () => {
  const result = await (
    await send('ended&preview=1', { DialCallStatus: 'failed' })
  ).text()
  expect(result).toContain('<Hangup/>')
  expect(result).not.toMatch(/<Redirect|<Dial/)
})
it('stores final words with their speaker and sequence only', async () => {
  const event = {
    TranscriptionEvent: 'transcription-content',
    Final: 'false',
    Track: 'inbound_track',
    SequenceId: '2',
    TranscriptionData: JSON.stringify({ transcript: 'Three bedrooms.' }),
  }
  await send('transcript', event)
  expect(m.append).not.toHaveBeenCalled()
  await send('transcript', { ...event, Final: 'true' })
  expect(m.append).toHaveBeenCalledWith({
    callSid: sid,
    role: 'user',
    sequence: 2,
    content: 'Three bedrooms.',
  })
})
