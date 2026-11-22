// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { issueCallToken } from '@/lib/phone-assistant/call-token'
vi.mock('@/supabase/server', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/ops/bookable-catalog', () => ({
  loadBookableCatalog: async () => [],
}))
const m = vi.hoisted(() => ({
  read: vi.fn(),
  run: vi.fn(),
  update: vi.fn(),
  latest: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
}))
vi.mock('@/lib/phone-assistant/records', () => ({
  getVoiceSessionDetails: m.read,
  latestCallerTurn: m.latest,
  claimVoiceExit: m.claim,
  finishVoiceExit: m.finish,
}))
vi.mock('@/lib/phone-assistant/engine', async () => {
  const { z } = await import('zod')
  return {
    phoneToolsForCall: () => [
      {
        name: 'phone_book_service',
        description: 'Save',
        inputSchema: z.object({}),
      },
      {
        name: 'lookup',
        description: 'Get price',
        inputSchema: z.object({ name: z.string() }),
      },
    ],
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
  m.latest.mockResolvedValue(1)
  m.claim.mockResolvedValue(true)
  vi.stubEnv('HARRY_VOICE_WEBHOOK_SECRET', 'mock-secret')
  m.read.mockResolvedValue({
    callSid: sid,
    providerCallId: 'live_1',
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
  expect(data.result.tools).toHaveLength(4)
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
    expect.objectContaining({
      callSid: sid,
      callerPhone: '+15551231234',
      preview: true,
      expectedCallerSequence: 1,
    }),
  )
})
it('sends emergency requests to the pilot keypad and never accepts a transfer number', async () => {
  const r = await send('tools/call', {
    name: 'request_flood_confirmation',
    arguments: {},
  })
  expect(r.status).toBe(200)
  await rpcResult(r)
  expect(m.update).toHaveBeenCalledWith({
    twiml: expect.stringContaining('context=harry-preview&amp;flood=prompt'),
  })
  expect(m.update.mock.calls[0][0].twiml).toContain('<Stop><Transcription')
})
it('denies an invite token or a closed session before calling tools', async () => {
  expect(
    (
      await send(
        'tools/list',
        {},
        issueCallToken(sid, 'live-invite:https://example.com'),
      )
    ).status,
  ).toBe(401)
  m.read.mockResolvedValue({ status: 'ended', providerCallId: 'live_1' })
  expect((await send('tools/list', {})).status).toBe(403)
  expect(m.run).not.toHaveBeenCalled()
})

it('marks tool-level business failures as MCP errors', async () => {
  m.run.mockResolvedValue({ error: 'Could not verify the booking.' })
  const r = await send('tools/call', {
    name: 'lookup',
    arguments: { name: 'Cleaning' },
  })
  expect((await rpcResult(r)).result).toMatchObject({ isError: true })
})

it('discards a stale tool result and releases an interrupted exit before dispatch', async () => {
  m.latest.mockResolvedValueOnce(4).mockResolvedValue(5)
  m.run.mockResolvedValue({ total: 300 })
  const r = await send('tools/call', {
    name: 'lookup',
    arguments: { name: 'Cleaning' },
  })
  expect((await rpcResult(r)).result.content[0].text).toContain('Obsolete')
  m.latest.mockResolvedValueOnce(7).mockResolvedValue(8)
  await rpcResult(await send('tools/call', { name: 'end_call', arguments: {} }))
  expect(m.finish).toHaveBeenCalledWith(sid, false)
  expect(m.update).not.toHaveBeenCalled()
})
it('deduplicates end-call and emergency transitions for public calls', async () => {
  m.read.mockResolvedValue({
    status: 'active',
    providerCallId: 'live_1',
    pilot: false,
    callerPhone: '+15551231234',
  })
  m.claim.mockResolvedValueOnce(true).mockResolvedValue(false)
  await rpcResult(await send('tools/call', { name: 'end_call', arguments: {} }))
  await send('tools/call', {
    name: 'request_flood_confirmation',
    arguments: {},
  })
  expect(m.update).toHaveBeenCalledTimes(1)
  expect(m.finish).toHaveBeenCalledWith(sid, true)
})

it('returns a committed booking receipt even when a later turn interrupts delivery', async () => {
  m.latest.mockResolvedValueOnce(4).mockResolvedValue(5)
  const receipt = {
    status: 'booked',
    appointment_id: 'unique-job-id',
    confirmation_number: 'SC-01234567',
    date: '2099-11-24',
    time: '14:00',
  }
  m.run.mockResolvedValue(receipt)
  const result = await rpcResult(
    await send('tools/call', { name: 'phone_book_service', arguments: {} }),
  )
  expect(JSON.parse(result.result.content[0].text)).toEqual({
    status: 'booked',
    date: receipt.date,
    time: receipt.time,
  })
  expect(result.result).not.toHaveProperty('committed')
})

it('withholds confirmation when a booking result lacks its internal receipt', async () => {
  m.run.mockResolvedValue({
    status: 'booked',
    date: '2099-11-24',
    time: '14:00',
    appointment_id: 'test',
  })
  const response = await rpcResult(
    await send('tools/call', { name: 'phone_book_service', arguments: {} }),
  )
  expect(response.result.isError).toBe(true)
  expect(response.result.content[0].text).not.toContain('"status":"booked"')
})
