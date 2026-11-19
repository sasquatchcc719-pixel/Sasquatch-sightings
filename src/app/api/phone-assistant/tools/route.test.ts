// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { issueCallToken } from '@/lib/phone-assistant/call-token'
const m = vi.hoisted(() => ({
  read: vi.fn(),
  sequence: vi.fn(),
  tools: vi.fn(),
  claim: vi.fn(),
  run: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/ops/bookable-catalog', () => ({
  loadBookableCatalog: async () => [],
}))
vi.mock('@/lib/phone-assistant/records', () => ({
  getVoiceSessionDetails: m.read,
  latestPreviewCallerTurn: m.sequence,
  previewExitClaim: m.claim,
}))
vi.mock('@/lib/phone-assistant/engine', async () => {
  const { z } = await import('zod')
  const tools = [
    {
      name: 'lookup',
      description: 'Get price',
      inputSchema: z.object({ name: z.string() }),
    },
  ]
  return {
    phoneTools: tools,
    previewPhoneTools: () => m.tools() ?? tools,
    runPhoneTool: m.run,
  }
})
vi.mock('@/lib/twilio/appointment-queue', () => ({
  queueBaseUrl: () => 'https://example.com',
  queueClient: () => ({ calls: () => ({ update: m.update }) }),
}))
import { POST } from './route'
const sid = 'CA' + 'b'.repeat(32)
function send(
  method: string,
  params: Record<string, unknown>,
  token = issueCallToken(sid, 'tools'),
) {
  return POST(
    new Request('https://example.com/api/phone-assistant/tools', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
}
async function rpcResult(response: Response) {
  const payload = await response.text()
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const line = payload.split('\n').find((value) => value.startsWith('data:'))
    if (!line) throw new Error('MCP response contained no data')
    return JSON.parse(line.slice(5))
  }
  return JSON.parse(payload)
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'mock-secret')
  m.read.mockResolvedValue({
    callSid: sid,
    providerCallId: 'rtc_1',
    status: 'active',
    pilot: true,
    callerPhone: '+15551231234',
  })
})
afterEach(() => vi.unstubAllEnvs())
it('lists only customer-scoped tools through the real MCP transport', async () => {
  const r = await send('tools/list', {})
  expect(r.status).toBe(200)
  const data = await rpcResult(r)
  expect(data.result.tools.map((t: { name: string }) => t.name)).toEqual(
    expect.arrayContaining([
      'lookup',
      'request_flood_confirmation',
      'end_call',
    ]),
  )
  expect(data.result.tools).toHaveLength(3)
})
it('takes the caller and preview mode from the bound session', async () => {
  m.run.mockResolvedValue({ total: 300 })
  const r = await send('tools/call', {
    name: 'lookup',
    arguments: { name: 'Cleaning' },
  })
  expect((await rpcResult(r)).result.isError).not.toBe(true)
  expect(m.run).toHaveBeenCalledWith(
    'lookup',
    { name: 'Cleaning' },
    { callSid: sid, callerPhone: '+15551231234', preview: true },
  )
})
it('sends emergency requests to the pilot keypad and never accepts a transfer number', async () => {
  const r = await send('tools/call', {
    name: 'request_flood_confirmation',
    arguments: {},
  })
  expect(r.status).toBe(200)
  expect(m.update).toHaveBeenCalledWith({
    twiml: expect.stringContaining('context=harry-preview&amp;flood=prompt'),
  })
  expect(m.update.mock.calls[0][0].twiml).toContain('<Stop><Transcription')
})
it('denies an invite token or a closed session before calling tools', async () => {
  expect(
    (await send('tools/list', {}, issueCallToken(sid, 'invite'))).status,
  ).toBe(401)
  m.read.mockResolvedValue({ status: 'ended', providerCallId: 'rtc_1' })
  expect((await send('tools/list', {})).status).toBe(403)
  expect(m.run).not.toHaveBeenCalled()
})
it('withholds old lookup details after a correction or disconnect', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.sequence.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  m.run.mockResolvedValue({ slot: 'Thursday' })
  const lookup = () =>
    send('tools/call', { name: 'lookup', arguments: { name: 'Cleaning' } })
  expect((await rpcResult(await lookup())).result.content[0].text).toContain(
    'Discard',
  )
  m.sequence.mockResolvedValue(2)
  m.run.mockImplementationOnce(async () => {
    m.read.mockResolvedValueOnce({ status: 'ended' })
    return { slot: 'Thursday' }
  })
  expect((await rpcResult(await lookup())).result.content[0].text).toContain(
    'Discard',
  )
})
it('dispatches at most one terminal command across retries', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.sequence.mockResolvedValue(1)
  m.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  for (const name of ['request_flood_confirmation', 'end_call']) {
    await send('tools/call', { name, arguments: {} })
  }
  expect(m.update).toHaveBeenCalledOnce()
})
it('releases an undispatched command if the caller corrects it', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  m.sequence.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  m.claim.mockResolvedValue(true)
  await send('tools/call', { name: 'end_call', arguments: {} })
  expect(m.claim).toHaveBeenLastCalledWith(sid, true)
  expect(m.update).not.toHaveBeenCalled()
})

it('passes canonical service IDs through the actual private MCP handler', async () => {
  vi.stubEnv('HARRY_VOICE_TEST_PROFILE', 'dispatcher-server')
  const { previewPhoneTools } = await vi.importActual<
    typeof import('@/lib/phone-assistant/engine')
  >('@/lib/phone-assistant/engine')
  const id = '8472f279-3dc3-44f3-85a4-c36166fdbe88'
  m.tools.mockReturnValue(
    previewPhoneTools([
      {
        id,
        name: 'Love Seat',
        slug: 'love-seat',
        category: 'Upholstery',
        pricing_unit: 'fixed',
        base_price: 100,
      },
    ]),
  )
  m.run.mockResolvedValue({ total: 190 })
  const payload = await rpcResult(
    await send('tools/call', {
      name: 'phone_quote',
      arguments: {
        zip_code: '80918',
        line_items: [{ service_id: 'love-seat', quantity: 1 }],
      },
    }),
  )
  expect(payload.result.isError).not.toBe(true)
  expect(m.run).toHaveBeenCalledWith(
    'phone_quote',
    { zip_code: '80918', line_items: [{ service_id: id, quantity: 1 }] },
    expect.anything(),
  )
})
