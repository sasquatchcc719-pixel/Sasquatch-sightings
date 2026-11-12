// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  admin: vi.fn(),
  bind: vi.fn(),
  accept: vi.fn(),
  complete: vi.fn(),
  state: vi.fn(),
  release: vi.fn(),
  fetchMember: vi.fn(),
}))
vi.mock('@/lib/twilio/inbound-auth', () => ({
  validateTwilioInboundRequest: m.auth,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: m.admin }))
vi.mock('@/lib/twilio/appointment-queue', async (original) => ({
  ...(await original<typeof import('@/lib/twilio/appointment-queue')>()),
  bindQueueWorker: m.bind,
  acceptQueueDispatch: m.accept,
  completeAppointmentAttempt: m.complete,
  getQueueDispatch: m.state,
  releaseQueueDispatch: m.release,
  queueClient: () => ({
    queues: () => ({ members: () => ({ fetch: m.fetchMember }) }),
  }),
}))
import { POST } from './route'
const token = '11111111-1111-4111-8111-111111111111'
const workerSid = `CA${'2'.repeat(32)}`
function request(params: Record<string, string> = {}, query = '') {
  return new NextRequest(
    `https://example.com/api/twilio/appointment-agent?token=${token}${query}`,
    {
      method: 'POST',
      body: new URLSearchParams({ CallSid: workerSid, ...params }),
    },
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  m.auth.mockReturnValue(true)
  m.admin.mockReturnValue({})
  m.bind.mockResolvedValue(true)
  m.accept.mockResolvedValue(true)
  m.complete.mockResolvedValue(true)
  m.state.mockResolvedValue({
    queue_sid: `QU${'1'.repeat(32)}`,
    caller_sid: `CA${'3'.repeat(32)}`,
  })
  m.fetchMember.mockResolvedValue({})
  m.release.mockResolvedValue(undefined)
})

describe('appointment cell phone acceptance', () => {
  it('requires a human keypress before connecting any waiting caller', async () => {
    const xml = await (await POST(request())).text()
    expect(xml).toContain('Press 1 to accept')
    expect(xml).toContain('<Gather')
    expect(xml).not.toContain('<Dial')
  })
  it('connects the shared FIFO queue after a valid acceptance', async () => {
    const xml = await (
      await POST(request({ Digits: '1' }, '&attempt=1'))
    ).text()
    expect(xml).toContain('<Queue')
    expect(xml).toContain('>sasquatch-appointments</Queue>')
    expect(xml).toContain('event=bridge&amp;token=')
    expect(xml).not.toContain('<Number')
    expect(m.accept).toHaveBeenCalledWith(expect.anything(), token, workerSid)
  })
  it.each(['', '2'])(
    'hangs up carrier voicemail or invalid input %s',
    async (Digits) => {
      const xml = await (await POST(request({ Digits }, '&attempt=1'))).text()
      expect(xml).toContain('<Hangup/>')
      expect(xml).not.toContain('<Dial')
      expect(m.release).not.toHaveBeenCalled()
    },
  )
  it('does not connect a stale attempt', async () => {
    m.bind.mockResolvedValueOnce(false)
    expect(await (await POST(request({ Digits: '1' }))).text()).toContain(
      '<Hangup/>',
    )
    expect(m.fetchMember).not.toHaveBeenCalled()
  })
  it('ends the phone attempt when its exact caller has left the queue', async () => {
    m.fetchMember.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { status: 404 }),
    )
    expect(await (await POST(request({ Digits: '1' }))).text()).toContain(
      '<Hangup/>',
    )
    expect(m.release).toHaveBeenCalledWith(expect.anything(), token, workerSid)
  })
  it.each(['completed', 'busy', 'no-answer', 'failed', 'canceled'])(
    'releases its matching worker on terminal status %s',
    async (CallStatus) => {
      expect(
        (await POST(request({ CallStatus }, '&event=status'))).status,
      ).toBe(204)
      expect(m.complete).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        token,
        workerSid,
      )
    },
  )
  it('does not let an old completed callback release a newer attempt', async () => {
    m.bind.mockResolvedValueOnce(false)
    await POST(request({ CallStatus: 'completed' }, '&event=status'))
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('does not release the slot while an answered conversation is active', async () => {
    await POST(request({ CallStatus: 'in-progress' }, '&event=status'))
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('ends a completed conversation without reconnecting another caller to the same call', async () => {
    expect(await (await POST(request({}, '&event=done'))).text()).toContain(
      '<Hangup/>',
    )
    expect(m.fetchMember).not.toHaveBeenCalled()
  })
  it('rejects unsigned acceptances', async () => {
    m.auth.mockReturnValueOnce(false)
    expect((await POST(request({ Digits: '1' }))).status).toBe(403)
    expect(m.bind).not.toHaveBeenCalled()
  })
})
