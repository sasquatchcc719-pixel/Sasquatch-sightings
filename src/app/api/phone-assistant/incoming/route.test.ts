// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import {
  issueCallToken,
  verifyCallToken,
} from '@/lib/phone-assistant/call-token'
const m = vi.hoisted(() => ({
  unwrap: vi.fn(),
  livePost: vi.fn(),
  liveResponse: vi.fn(),
  catalog: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  get: vi.fn(),
  bind: vi.fn(),
  claim: vi.fn(),
  mark: vi.fn(),
  after: vi.fn(),
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
    realtime = { calls: { accept: m.accept, reject: m.reject } }
  },
}))
vi.mock('next/server', () => ({ after: m.after }))
vi.mock('@/lib/phone-assistant/records', () => ({
  getVoiceSessionDetails: m.get,
  bindVoiceProviderCall: m.bind,
  claimPreviewOpening: m.claim,
  markVoiceAnswered: m.mark,
}))
vi.mock('@/lib/phone-assistant/engine', () => ({
  phoneInstructions: () => 'Business rules',
  phoneGreeting: 'Test greeting',
  phoneTools: [{ name: 'phone_catalog' }, { name: 'phone_quote' }],
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
  m.catalog.mockResolvedValue([])
  m.bind.mockResolvedValue(true)
  m.get.mockResolvedValue({ callSid: sid, status: 'active', pilot: true })
  m.accept.mockResolvedValue(undefined)
  m.livePost.mockImplementation(() => ({ asResponse: m.liveResponse }))
  m.liveResponse.mockResolvedValue(new Response(null, { status: 200 }))
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
          turn_detection: expect.objectContaining({
            interrupt_response: true,
            silence_duration_ms: 500,
          }),
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
it('only retries explicit semantic detector validation failures', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'detector-medium')
  m.accept.mockRejectedValueOnce(
    Object.assign(Error('unsupported turn_detection'), { status: 422 }),
  )
  expect((await send()).status).toBe(204)
  expect(
    m.accept.mock.calls.map(([, body]) => body.audio.input.turn_detection.type),
  ).toEqual(['semantic_vad', 'server_vad'])
  expect(m.accept.mock.calls[1][2].headers['Idempotency-Key']).toBe(
    'evt_test-server-vad',
  )
  m.accept.mockReset().mockRejectedValueOnce(Error('timeout'))
  expect((await send()).status).toBe(503)
  expect(m.accept).toHaveBeenCalledOnce()
})
it('assigns the one-shot greeting to just one delivery', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  await send()
  await send()
  expect(m.after).toHaveBeenCalledOnce()
})

it('answers private item pricing from current catalog data and asks for ZIP before quoting', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.catalog.mockResolvedValue([
    {
      id: 'sofa-id',
      category: 'Upholstery',
      name: 'Sofa 3 Seat',
      base_price: 151,
      pricing_unit: 'fixed',
    },
  ])
  await send()
  expect(m.accept.mock.calls[0][1].instructions).toContain(
    '["sofa-id","Upholstery","Sofa 3 Seat",151,"fixed"]',
  )
  expect(m.accept.mock.calls[0][1].instructions).toContain(
    'If only ZIP is missing',
  )
  expect(m.accept.mock.calls[0][1].tools[0].allowed_tools).toEqual([
    'phone_quote',
    'request_flood_confirmation',
    'end_call',
  ])
  vi.stubEnv('VERCEL_ENV', 'production')
  await send()
  expect(m.catalog).toHaveBeenCalledTimes(1)
  expect(m.accept.mock.calls[1][1].instructions).not.toContain('sofa-id')
})
it('keeps live lookup available when the preview catalog is unavailable', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.catalog.mockRejectedValue(Error('timeout'))
  expect((await send()).status).toBe(204)
  expect(m.accept.mock.calls[0][1].instructions).not.toContain(
    'Current public catalog rows',
  )
  expect(m.accept.mock.calls[0][1].tools[0].allowed_tools).toBeUndefined()
})

const previewBase = 'https://example.com'
const privateHeader = 'X-Sightings-Live-Invite'
const liveToken = () => issueCallToken(sid, 'live-invite:https://example.com')
function configureLive() {
  vi.stubEnv('HARRY_VOICE_TEST_TRANSPORT', 'live')
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  vi.stubEnv('VERCEL_ENV', 'preview')
  m.get.mockResolvedValue({
    callSid: sid,
    providerCallId: null,
    status: 'active',
    startedAt: new Date().toISOString(),
    pilot: true,
  })
  m.mark.mockResolvedValue(true)
}
function liveEvent(value = liveToken(), id = 'live_session-17') {
  return {
    id: 'evt_live',
    type: 'live.transport.incoming',
    data: {
      type: 'sip',
      session_id: id,
      sip_headers: [{ name: privateHeader, value }],
    },
  }
}

it('answers only signed, isolated Live pilots with scoped hosted business tools and one post-connect greeting', async () => {
  configureLive()
  m.unwrap.mockResolvedValue(liveEvent())
  expect((await send()).status).toBe(204)
  expect(m.accept).not.toHaveBeenCalled()
  expect(m.after).not.toHaveBeenCalled()
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
            server_url: previewBase + '/api/phone-assistant/tools',
            allowed_tools: [
              'phone_catalog',
              'phone_quote',
              'request_flood_confirmation',
              'end_call',
            ],
          },
        ],
      },
    },
  })
  expect(config.audio).not.toHaveProperty('format')
  expect(config.input[0].content[0].text).toContain('already begun speaking')
  expect(config.input[0].content[0].text).toContain('leave a message')
  expect(config.instructions).toContain(
    'pet urine treatment, rugs, furniture and tile',
  )
  expect(config.delegation.responses.instructions).toContain('Active coaching')
  const token = config.delegation.responses.tools[0].authorization
  expect(verifyCallToken(token, 'tools')).toBe(sid)
  expect(verifyCallToken(token, 'invite')).toBeNull()
})
it('ignores the competing event without accepting or rejecting the call', async () => {
  configureLive()
  const live = liveEvent()
  m.unwrap.mockResolvedValueOnce({
    ...incoming('unused'),
    data: { call_id: 'rtc_competing', sip_headers: live.data.sip_headers },
  })
  await send()
  m.unwrap.mockResolvedValueOnce({
    ...live,
    data: {
      ...live.data,
      sip_headers: incoming(issueCallToken(sid, 'invite')).data.sip_headers,
    },
  })
  await send()
  expect(m.accept).not.toHaveBeenCalled()
  expect(m.reject).not.toHaveBeenCalled()
  expect(m.livePost).not.toHaveBeenCalled()
  expect(m.bind).not.toHaveBeenCalled()
})
it('cannot opt a public, development, unscoped, wrong-origin, or inactive call into Live', async () => {
  configureLive()
  for (const token of [
    issueCallToken(sid, 'invite'),
    issueCallToken(sid, 'tools'),
    issueCallToken(sid, 'live-invite:https://elsewhere.example'),
  ]) {
    m.unwrap.mockResolvedValueOnce(liveEvent(token))
    await send()
  }
  m.get
    .mockResolvedValueOnce({ pilot: false, status: 'active' })
    .mockResolvedValueOnce({ pilot: true, status: 'ended' })
  m.unwrap.mockResolvedValue(liveEvent())
  await send()
  await send()
  await POST(
    new Request('https://different.example/api/phone-assistant/incoming', {
      method: 'POST',
      body: '{}',
    }),
  )
  vi.stubEnv('VERCEL_ENV', 'development')
  await send()
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('HARRY_VOICE_TEST_TRANSPORT', '')
  await send()
  expect(m.bind).not.toHaveBeenCalled()
  expect(m.livePost).not.toHaveBeenCalled()
  expect(m.mark).not.toHaveBeenCalled()
})
it('accepts the signed private pilot on the matching production origin', async () => {
  configureLive()
  vi.stubEnv('VERCEL_ENV', 'production')
  m.unwrap.mockResolvedValue(liveEvent())
  expect((await send()).status).toBe(204)
  expect(m.bind).toHaveBeenCalledWith(sid, 'live_session-17')
  expect(m.livePost).toHaveBeenCalledWith(
    '/live/sessions/live_session-17/accept',
    expect.objectContaining({ body: { session: expect.any(Object) } }),
  )
  expect(m.mark).toHaveBeenCalledWith(sid, 'live_session-17')
})
it('deduplicates a successful Live acceptance and never marks a failed or ambiguous decision answered', async () => {
  configureLive()
  m.unwrap.mockResolvedValue(liveEvent())
  m.liveResponse.mockRejectedValueOnce(Error('network'))
  expect((await send()).status).toBe(503)
  m.liveResponse.mockRejectedValueOnce(
    Object.assign(Error('conflict'), { status: 409 }),
  )
  expect((await send()).status).toBe(503)
  expect(m.mark).not.toHaveBeenCalled()
  m.get.mockResolvedValue({
    pilot: true,
    status: 'active',
    providerCallId: 'live_session-17',
    answeredAt: 'confirmed',
  })
  expect((await send()).status).toBe(204)
  expect(m.livePost).toHaveBeenCalledTimes(2)
})
it('rejects a second Live ID for the same authenticated pilot without starting a new call', async () => {
  configureLive()
  m.unwrap.mockResolvedValue(liveEvent())
  m.bind.mockResolvedValue(false)
  expect((await send()).status).toBe(204)
  expect(m.livePost).toHaveBeenCalledWith(
    '/live/sessions/live_session-17/reject',
    { body: { status_code: 403 } },
  )
  expect(m.mark).not.toHaveBeenCalled()
})

it('verifies a native Live webhook signature and sends the published accept payload with the installed SDK', async () => {
  configureLive()
  const [{ default: NativeOpenAI }, { Webhook }] = await Promise.all([
    vi.importActual<typeof import('openai')>('openai'),
    import('standardwebhooks'),
  ])
  const secret =
    'whsec_' +
    Buffer.from('synthetic signing key for this routing test').toString(
      'base64',
    )
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', secret)
  const payload = JSON.stringify(liveEvent())
  const timestamp = new Date()
  const signature = new Webhook(secret).sign('whmsg_123', timestamp, payload)
  const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
  const sdk = new NativeOpenAI({
    apiKey: 'fixture-key',
    baseURL: 'https://provider.invalid/v1',
    fetch: fetchSpy,
  })
  m.unwrap.mockImplementation(sdk.webhooks.unwrap.bind(sdk.webhooks))
  m.livePost.mockImplementation(sdk.post.bind(sdk))
  const signed = (body: string) =>
    POST(
      new Request(previewBase + '/api/phone-assistant/incoming', {
        method: 'POST',
        body,
        headers: {
          'webhook-id': 'whmsg_123',
          'webhook-signature': signature,
          'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
        },
      }),
    )
  expect((await signed(payload + ' ')).status).toBe(403)
  expect(fetchSpy).not.toHaveBeenCalled()
  expect((await signed(payload)).status).toBe(204)
  expect(fetchSpy).toHaveBeenCalledOnce()
  expect(fetchSpy).toHaveBeenCalledWith(
    'https://provider.invalid/v1/live/sessions/live_session-17/accept',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"type":"responses"'),
    }),
  )
})
