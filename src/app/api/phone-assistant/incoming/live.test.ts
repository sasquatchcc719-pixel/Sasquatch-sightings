// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  issueCallToken,
  verifyCallToken,
} from '@/lib/phone-assistant/call-token'

const m = vi.hoisted(() => ({
  unwrap: vi.fn(),
  livePost: vi.fn(),
  liveResponse: vi.fn(),
  catalog: vi.fn(),
  get: vi.fn(),
  bind: vi.fn(),
  mark: vi.fn(),
  recognize: vi.fn(),
}))

vi.mock('@/lib/ops/bookable-catalog', () => ({
  loadBookableCatalog: m.catalog,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/phone-assistant/coaching', () => ({
  coachingInstructions: async () => 'Active coaching',
}))
vi.mock('openai', () => ({
  default: class {
    static APIError = Error
    webhooks = { unwrap: m.unwrap }
    post = m.livePost
  },
}))
vi.mock('@/lib/phone-assistant/records', () => ({
  getVoiceSessionDetails: m.get,
  bindVoiceProviderCall: m.bind,
  markVoiceAnswered: m.mark,
}))
vi.mock('@/lib/phone-assistant/caller', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/phone-assistant/caller')>()),
  recognizePhoneCaller: m.recognize,
}))
vi.mock('@/lib/twilio/appointment-queue', () => ({
  queueBaseUrl: () => 'https://example.com',
}))

import { POST } from './route'

const sid = 'CA' + 'b'.repeat(32)
const privateHeader = 'X-Sightings-Live-Invite'
const liveToken = () => issueCallToken(sid, 'live-invite:https://example.com')
const liveEvent = (value = liveToken(), id = 'live_session-17') => ({
  id: 'evt_live',
  type: 'live.transport.incoming',
  data: {
    type: 'sip',
    session_id: id,
    sip_headers: [{ name: privateHeader, value }],
  },
})
const send = (url = 'https://example.com/api/phone-assistant/incoming') =>
  POST(new Request(url, { method: 'POST', body: '{}' }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'mock-secret')
  vi.stubEnv('OPENAI_API_KEY', 'mock-key')
  vi.stubEnv('VERCEL_ENV', 'preview')
  m.unwrap.mockResolvedValue(liveEvent())
  m.catalog.mockResolvedValue([])
  m.bind.mockResolvedValue(true)
  m.mark.mockResolvedValue(true)
  m.get.mockResolvedValue({
    callSid: sid,
    callerPhone: '+17195550123',
    providerCallId: null,
    status: 'active',
    startedAt: new Date().toISOString(),
    pilot: true,
  })
  m.recognize.mockResolvedValue({ firstName: 'Charles' })
  m.livePost.mockImplementation(() => ({ asResponse: m.liveResponse }))
  m.liveResponse.mockResolvedValue(new Response(null, { status: 200 }))
})

afterEach(() => vi.unstubAllEnvs())

it('requires a valid provider signature', async () => {
  m.unwrap.mockRejectedValueOnce(Error('not signed'))
  expect((await send()).status).toBe(403)
  expect(m.livePost).not.toHaveBeenCalled()
  expect(m.bind).not.toHaveBeenCalled()
})

it('ignores a provider-signed retired call even with its original valid invite', async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-11-22T18:00:00Z'))
    // Captured test credential, signed by mock-secret and valid until 18:02 UTC.
    m.unwrap.mockResolvedValueOnce({
      id: 'evt_retired',
      type: 'realtime.call.incoming',
      data: {
        call_id: 'rtc_fixture',
        sip_headers: [
          {
            name: 'X-Sightings-Invite',
            value:
              'CAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.1795370520.TxqzrPNp8_3KYiU3oG9sUHspopdHBjSgeCRTOU9sbx8',
          },
        ],
      },
    })
    expect((await send()).status).toBe(204)
    expect(m.get).not.toHaveBeenCalled()
    expect(m.bind).not.toHaveBeenCalled()
    expect(m.livePost).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('accepts a signed GPT Live pilot with scoped tools and caller recognition', async () => {
  expect((await send()).status).toBe(204)
  expect(m.bind).toHaveBeenCalledWith(sid, 'live_session-17')
  expect(m.mark).toHaveBeenCalledWith(sid, 'live_session-17')
  const [path, options] = m.livePost.mock.calls[0]
  expect(path).toBe('/live/sessions/live_session-17/accept')
  const config = options.body.session
  expect(config).toMatchObject({
    type: 'live',
    model: 'gpt-live-1.1',
    audio: { output: { voice: 'meridian' } },
    input: [{ role: 'developer' }],
    delegation: {
      type: 'responses',
      responses: {
        model: 'gpt-6-luna',
        parallel_tool_calls: false,
        tools: [
          {
            type: 'mcp',
            server_url: 'https://example.com/api/phone-assistant/tools',
            allowed_tools: expect.arrayContaining([
              'phone_usual_address',
              'phone_caller_lookup',
              'phone_catalog',
              'phone_service_area',
              'phone_quote',
              'phone_quoted_openings',
              'phone_openings',
              'phone_preview_booking',
              'phone_preview_change',
              'request_flood_confirmation',
              'end_call',
            ]),
          },
        ],
      },
    },
  })
  expect(config.input[0].content[0].text).toContain(
    'Harry here. Is this Charles?',
  )
  expect(config.delegation.responses.tools[0].allowed_tools).not.toContain(
    'phone_book_service',
  )
  expect(config.delegation.responses.tools[0].allowed_tools).not.toContain(
    'phone_book_measurement',
  )
  expect(config.delegation.responses.tools[0].allowed_tools).toHaveLength(11)
  expect(config.instructions).toContain('never identity verification')
  expect(config.delegation.responses.instructions).toContain(
    'grants no staff privileges',
  )

  expect(config.instructions).toContain(
    'pet urine treatment, rugs, furniture and tile',
  )
  expect(config.delegation.responses.instructions).toContain('Active coaching')
  const token = config.delegation.responses.tools[0].authorization
  expect(verifyCallToken(token, 'tools')).toBe(sid)
  expect(verifyCallToken(token, 'live-invite:https://example.com')).toBeNull()
})

it('uses a neutral returning greeting for shared numbers', async () => {
  m.recognize.mockResolvedValue({ firstName: null })
  await send()
  const opening =
    m.livePost.mock.calls[0][1].body.session.input[0].content[0].text
  expect(opening).toContain('Can I get your name?')
  expect(opening).not.toContain('Is this')
})

it('uses the neutral GPT Live opening for an unknown caller', async () => {
  m.recognize.mockResolvedValue(null)
  await send()
  const config = m.livePost.mock.calls[0][1].body.session
  expect(config.input[0].content[0].text).toContain('leave a message')
  expect(config.input[0].content[0].text).not.toContain('is this Charles')
})

it('rejects unscoped, wrong-origin, inactive, and public preview sessions', async () => {
  for (const token of [
    'invalid',
    issueCallToken(sid, 'tools'),
    issueCallToken(sid, 'live-invite:https://elsewhere.example'),
  ]) {
    m.unwrap.mockResolvedValueOnce(liveEvent(token))
    await send()
  }
  m.get
    .mockResolvedValueOnce({ pilot: true, status: 'ended' })
    .mockResolvedValueOnce({ pilot: false, status: 'active' })
  m.unwrap.mockResolvedValue(liveEvent())
  await send()
  await send()
  await send('https://different.example/api/phone-assistant/incoming')
  expect(m.bind).not.toHaveBeenCalled()
  expect(m.livePost).not.toHaveBeenCalled()
  expect(m.mark).not.toHaveBeenCalled()
})

it('supplies live scheduling tools and verified customer, receipt, pricing and attribution rules to the production delegate', async () => {
  vi.stubEnv('VERCEL_ENV', 'production')
  m.get.mockResolvedValue({
    callSid: sid,
    callerPhone: '+17195550123',
    providerCallId: null,
    status: 'active',
    startedAt: new Date().toISOString(),
    pilot: false,
  })
  expect((await send()).status).toBe(204)
  const config = m.livePost.mock.calls[0][1].body.session
  const backend = config.delegation.responses
  expect([...backend.tools[0].allowed_tools].sort()).toEqual(
    [
      'phone_usual_address',
      'phone_caller_lookup',
      'phone_catalog',
      'phone_service_area',
      'phone_quote',
      'phone_quoted_openings',
      'phone_openings',
      'phone_book_service',
      'phone_book_measurement',
      'request_flood_confirmation',
      'end_call',
    ].sort(),
  )
  for (const rule of [
    'caller-supplied details',
    'Ask permission to use the email on file',
    'verify the spelling',
    'call phone_openings once',
    'same coupon',
    'conditional prices',
    'repeat_customer',
    'confirmed_total',
    'status booked with the saved day and time',
    'office callback request',
    'phone_book_measurement',
  ])
    expect(backend.instructions).toContain(rule)
  expect(backend.instructions).not.toContain('phone_preview_booking')
  expect(config.instructions).not.toContain('Nothing will actually be booked')
  expect(config.instructions).toContain('only when a tool confirms')
})

it('deduplicates acceptance and never marks a failed decision answered', async () => {
  m.liveResponse.mockRejectedValueOnce(Error('network'))
  expect((await send()).status).toBe(503)
  expect(m.mark).not.toHaveBeenCalled()

  m.liveResponse.mockRejectedValueOnce(
    Object.assign(Error('conflict'), { status: 409 }),
  )
  m.get.mockResolvedValue({
    pilot: true,
    status: 'active',
    providerCallId: 'live_session-17',
    answeredAt: 'confirmed',
  })
  expect((await send()).status).toBe(204)
  expect(m.mark).not.toHaveBeenCalled()
})

it('rejects a second Live ID for the same authenticated call', async () => {
  m.bind.mockResolvedValue(false)
  expect((await send()).status).toBe(204)
  expect(m.livePost).toHaveBeenCalledWith(
    '/live/sessions/live_session-17/reject',
    { body: { status_code: 403 } },
  )
  expect(m.mark).not.toHaveBeenCalled()
})
