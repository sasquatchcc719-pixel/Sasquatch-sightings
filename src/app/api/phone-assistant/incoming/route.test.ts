// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { issueCallToken } from '@/lib/phone-assistant/call-token'
const m = vi.hoisted(() => ({
  unwrap: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  get: vi.fn(),
  bind: vi.fn(),
  mark: vi.fn(),
  after: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/phone-assistant/coaching', () => ({
  coachingInstructions: async () => 'Active coaching',
}))
vi.mock('openai', () => ({
  default: class {
    static APIError = Error
    webhooks = { unwrap: m.unwrap }
    realtime = { calls: { accept: m.accept, reject: m.reject } }
  },
}))
vi.mock('next/server', () => ({ after: m.after }))
vi.mock('@/lib/phone-assistant/records', () => ({
  getVoiceSessionDetails: m.get,
  bindVoiceProviderCall: m.bind,
  markVoiceAnswered: m.mark,
}))
vi.mock('@/lib/phone-assistant/engine', () => ({
  phoneInstructions: () => 'Business rules',
  phoneGreeting: 'Test greeting',
}))
vi.mock('@/lib/twilio/appointment-queue', () => ({
  queueBaseUrl: () => 'https://example.com',
}))
import { POST } from './route'
const sid = 'CA' + 'b'.repeat(32)
const incoming = (token: string) => ({
  id: 'evt_test',
  type: 'realtime.call.incoming',
  data: {
    call_id: 'rtc_1',
    sip_headers: [{ name: 'X-Sightings-Invite', value: token }],
  },
})
const send = () =>
  POST(
    new Request('https://example.com/api/phone-assistant/incoming', {
      method: 'POST',
      body: '{}',
    }),
  )
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'mock-secret')
  vi.stubEnv('OPENAI_API_KEY', 'mock-key')
  m.unwrap.mockResolvedValue(incoming(issueCallToken(sid, 'invite')))
  m.bind.mockResolvedValue(true)
  m.get.mockResolvedValue({ callSid: sid, status: 'active', pilot: true })
  m.accept.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())
it('checks both provider signature and private invite before accepting', async () => {
  m.unwrap.mockRejectedValueOnce(Error('not signed'))
  expect((await send()).status).toBe(403)
  m.unwrap.mockResolvedValueOnce(incoming('invalid'))
  await send()
  expect(m.reject).toHaveBeenCalledWith('rtc_1', { status_code: 403 })
  expect(m.accept).not.toHaveBeenCalled()
})
it('accepts an authenticated call with interruptible audio and call-scoped tools', async () => {
  expect((await send()).status).toBe(204)
  expect(m.bind).toHaveBeenCalledWith(sid, 'rtc_1')
  expect(m.accept).toHaveBeenCalledWith(
    'rtc_1',
    expect.objectContaining({
      instructions: expect.stringContaining('Active coaching'),
      audio: expect.objectContaining({
        output: { voice: 'cedar', speed: 0.97 },
        input: {
          turn_detection: expect.objectContaining({ interrupt_response: true }),
        },
      }),
      tools: [
        expect.objectContaining({
          server_url: 'https://example.com/api/phone-assistant/tools',
        }),
      ],
    }),
    expect.anything(),
  )
  expect(m.mark).toHaveBeenCalledWith(sid, 'rtc_1')
  expect(m.after).toHaveBeenCalledOnce()
})
it('does not classify a failed connection as answered', async () => {
  m.accept.mockRejectedValueOnce(Error('provider unavailable'))
  expect((await send()).status).toBe(503)
  expect(m.mark).not.toHaveBeenCalled()
})
