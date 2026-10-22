// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  write: vi.fn(),
  bind: vi.fn(),
  state: vi.fn(),
  dispatch: vi.fn(),
  after: vi.fn(),
}))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: m.after,
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: m.auth,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: m.admin }))
vi.mock('@/lib/twilio/call-history', () => ({ writeCallLog: m.write }))
vi.mock('@/lib/twilio/appointment-queue', async (original) => ({
  ...(await original<typeof import('@/lib/twilio/appointment-queue')>()),
  bindQueueWorker: m.bind,
  getQueueDispatch: m.state,
  dispatchAppointmentCall: m.dispatch,
}))
import { POST } from './route'

const callSid = `CA${'1'.repeat(32)}`
const workerSid = `CA${'2'.repeat(32)}`
const queueSid = `QU${'3'.repeat(32)}`
function request(event: string, params: Record<string, string> = {}) {
  return new NextRequest(
    `https://example.com/api/twilio/appointment-queue?event=${event}&token=attempt`,
    {
      method: 'POST',
      body: new URLSearchParams({
        CallSid: callSid,
        From: '+17195550100',
        ...params,
      }),
    },
  )
}
const update = vi.fn()
const maybeSingle = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  m.auth.mockReturnValue(true)
  m.bind.mockResolvedValue(true)
  m.state.mockResolvedValue({ queue_sid: queueSid })
  m.write.mockResolvedValue(undefined)
  m.dispatch.mockResolvedValue(undefined)
  maybeSingle.mockResolvedValue({
    data: {
      forwarding_accepted_at: new Date(Date.now() - 42_000).toISOString(),
    },
    error: null,
  })
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    update,
    maybeSingle,
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  }
  update.mockReturnValue(query)
  m.admin.mockReturnValue({ from: vi.fn(() => query) })
})

describe('appointment queue provider callbacks', () => {
  it('returns hold music immediately and dispatches after the response', async () => {
    const response = await POST(request('wait', { QueueTime: '0' }))
    expect(await response.text()).toContain('appointment-hold.mp3')
    expect(m.dispatch).not.toHaveBeenCalled()
    await m.after.mock.calls[0][0]()
    expect(m.dispatch).toHaveBeenCalledOnce()
  })
  it('exits at 180 seconds without starting another phone attempt', async () => {
    expect(
      await (await POST(request('wait', { QueueTime: '180' }))).text(),
    ).toContain('<Leave/>')
    expect(m.after).not.toHaveBeenCalled()
  })
  it('does not delay the final one-second wait for a slow dispatcher', async () => {
    m.dispatch.mockImplementation(() => new Promise(() => {}))
    expect(
      await (await POST(request('wait', { QueueTime: '179' }))).text(),
    ).toContain('<Pause length="1"/>')
    expect(m.dispatch).not.toHaveBeenCalled()
  })
  it.each(['leave', 'queue-full', 'error', 'system-error'])(
    'routes %s to the existing voicemail flow',
    async (QueueResult) => {
      expect(
        await (await POST(request('result', { QueueResult }))).text(),
      ).toContain('/api/twilio/call-after-hours')
      expect(m.write).not.toHaveBeenCalled()
    },
  )
  it.each(['bridged', 'redirected-from-bridged'])(
    'finishes %s as answered without voicemail or a missed-call text',
    async (QueueResult) => {
      const xml = await (await POST(request('result', { QueueResult }))).text()
      expect(xml).toContain('<Hangup/>')
      expect(xml).not.toContain('call-after-hours')
      expect(m.write).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'answered', duration_seconds: 42 }),
      )
    },
  )
  it('still hangs up an answered conversation if logging is unavailable', async () => {
    m.write.mockRejectedValueOnce(new Error('Database unavailable'))
    expect(
      await (await POST(request('result', { QueueResult: 'bridged' }))).text(),
    ).toContain('<Hangup/>')
  })
  it('does not send a caller who hung up to voicemail', async () => {
    expect(
      await (await POST(request('result', { QueueResult: 'hangup' }))).text(),
    ).toContain('<Hangup/>')
  })
  it('records the actual FIFO caller and worker only at the bridge callback', async () => {
    const response = await POST(
      request('bridge', { QueueSid: queueSid, DequeingCallSid: workerSid }),
    )
    expect(response.status).toBe(200)
    expect(m.bind).toHaveBeenCalledWith(expect.anything(), 'attempt', workerSid)
    expect(m.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        call_sid: callSid,
        outcome: 'answered',
        forwarding_accepted_at: expect.any(String),
      }),
    )
    expect(m.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ queue_worker_sid: workerSid }),
    )
  })
  it('rejects a stale dispatcher without marking a caller answered', async () => {
    m.bind.mockResolvedValueOnce(false)
    expect(
      (
        await POST(
          request('bridge', { QueueSid: queueSid, DequeingCallSid: workerSid }),
        )
      ).status,
    ).toBe(403)
    expect(m.write).not.toHaveBeenCalled()
  })
  it('rejects callbacks from a different queue', async () => {
    expect(
      (
        await POST(
          request('bridge', { QueueSid: 'wrong', DequeingCallSid: workerSid }),
        )
      ).status,
    ).toBe(403)
    expect(m.bind).not.toHaveBeenCalled()
  })
  it('rejects unsigned callbacks before touching the queue', async () => {
    m.auth.mockReturnValue(false)
    expect((await POST(request('wait', { QueueTime: '0' }))).status).toBe(403)
    expect(m.after).not.toHaveBeenCalled()
    expect(m.admin).not.toHaveBeenCalled()
  })
})
