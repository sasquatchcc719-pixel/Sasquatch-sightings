// @vitest-environment node
import { verifyCallToken } from '@/lib/phone-assistant/call-token'
import { NextRequest } from 'next/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  signed: vi.fn(),
  previewCall: vi.fn(),
  access: vi.fn(),
  start: vi.fn(),
  append: vi.fn(),
  config: vi.fn(),
  base: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: m.signed,
}))
vi.mock('@/lib/twilio/harry-access', () => ({
  getHarryAccess: m.access,
  harryPreviewReady: () => true,
  isHarryPreviewCall: m.previewCall,
  isHarryMainNumber: (n: string) => n === '+15550000001',
}))
vi.mock('@/lib/twilio/appointment-queue', () => ({
  queueBaseUrl: m.base,
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
    new NextRequest(m.base() + '/api/twilio/harry-voice?step=' + step, {
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
  m.base.mockReturnValue('https://example.com')
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'test-key')
  vi.stubEnv('HARRY_VOICE_PROJECT_ID', 'proj_test')
  vi.stubEnv('VERCEL_ENV', 'production')
})
afterEach(() => vi.unstubAllEnvs())
it('starts native SIP and both-track transcription for the authorized preview', async () => {
  const result = await (await send('start&preview=1')).text()
  expect(result).toContain('secure=true?X-Sightings-Live-Invite=')
  expect(result).toContain('track="both_tracks"')
  expect(result).toContain('simulated')
  expect(m.start).toHaveBeenCalledWith({
    callSid: sid,
    callerPhone: '+15550000123',
    pilot: true,
  })
})
it('accepts an unregistered caller only after this exact call was marked as a keypad test', async () => {
  m.access.mockResolvedValue({ preview: false, publicEnabled: false })
  m.previewCall.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const step = 'start&preview=1&entry=keypad'
  expect(await (await send(step)).text()).not.toContain('<Sip>')
  expect(await (await send(step)).text()).toContain('<Sip>')
  expect(m.previewCall).toHaveBeenCalledWith(sid, '+15550000123')
  expect(m.start).toHaveBeenCalledTimes(1)
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
it('keeps full test disclosure before connecting GPT Live', async () => {
  expect(await (await send('start&preview=1')).text()).toContain(
    'Bookings and transfers are simulated.',
  )
})
it('gives Live pilots a signed origin-bound invite and full disclosure before connecting audio', async () => {
  const twiml = await (await send('start&preview=1')).text()
  const token = twiml.match(/X-Sightings-Live-Invite=([\w.-]+)/)?.[1] ?? ''
  expect(verifyCallToken(token, 'live-invite:https://example.com')).toBe(sid)
  expect(verifyCallToken(token, 'tools')).toBeNull()
  expect(twiml).toMatch(
    /<Say>[^<]*transcribed[^<]*virtual assistant[^<]*Bookings and transfers are simulated\.<\/Say><Start>/,
  )
  expect(twiml).toContain('Sasquatch Carpet Cleaning after-hours directory')
  expect(twiml).not.toMatch(/How can I help|X-Sightings-Invite=/)
  m.base.mockReturnValue('https://sightings.sasquatchcarpet.com')
  const production = await (await send('start&preview=1')).text()
  expect(production).toContain('X-Sightings-Live-Invite=')
  expect(production).not.toContain('unavailable right now')
})
