import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/ops/first-customer-message', () => ({ definitelyRejected: (e: { status?: number; code?: number }) => e.status === 400 && !!e.code }))
import { missedCallSid, claimCallFollowUp, sendClaimedCallFollowUp } from './call-follow-up-guard'
const call = { call_sid: `CA${'1'.repeat(32)}`, token: 'token' }
const sid = `SM${'2'.repeat(32)}`
describe('call-scoped send guard', () => {
 it('recognizes only the exact versioned key', () => {
  expect(missedCallSid(`missed-call:${call.call_sid}:v1`)).toBe(call.call_sid)
  expect(missedCallSid('ordinary-reply')).toBeNull()
  expect(() => missedCallSid('missed-call:old:v1')).toThrow()
 })
 it('fails closed on claim errors and denied eligibility', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ error: new Error('unavailable') }).mockResolvedValueOnce({ data: { eligible: false } })
  await expect(claimCallFollowUp({ rpc } as never, { phone: '+17195551234', callSid: call.call_sid })).rejects.toThrow('unavailable')
  expect(await claimCallFollowUp({ rpc } as never, { phone: '+17195551234', callSid: call.call_sid })).toBeNull()
 })
 it('records provider acceptance once', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const send = vi.fn().mockResolvedValue({ sid })
  await sendClaimedCallFollowUp({ rpc } as never, call, send)
  expect(send).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('finish_call_follow_up', expect.objectContaining({ p_status: 'accepted', p_twilio_sid: sid }))
 })
 it('never retries a network timeout', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const send = vi.fn().mockRejectedValue(new Error('timeout'))
  await expect(sendClaimedCallFollowUp({ rpc } as never, call, send)).rejects.toThrow('timeout')
  expect(send).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith('finish_call_follow_up', expect.objectContaining({ p_status: 'unknown' }))
 })
 it('reports acceptance if final persistence fails without marking rejected', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: new Error('database unavailable') })
  const send = vi.fn().mockResolvedValue({ sid })
  await expect(sendClaimedCallFollowUp({ rpc } as never, call, send)).rejects.toThrow(`Provider accepted ${sid}`)
  expect(send).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledTimes(1)
 })
})
