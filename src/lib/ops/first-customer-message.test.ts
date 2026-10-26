// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/twilio', () => ({ sendCustomerSMSWithResult: vi.fn() }))
import {
  definitelyRejected,
  FirstMessageOutcomeError,
  sendFirstCustomerMessage,
} from './first-customer-message'
const sid = `SM${'a'.repeat(32)}`
function fixture(finishError = false) {
  let claimed = false
  const outcomes: string[] = []
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_mcp_first_message') {
        if (claimed)
          return {
            data: { claimed: false, status: outcomes.at(-1) || 'sending' },
            error: null,
          }
        claimed = true
        return {
          data: {
            claimed: true,
            phone: '+17195550100',
            body: 'Exact approved question',
            customer_id: 'customer',
          },
          error: null,
        }
      }
      if (finishError) return { error: { message: 'Database unavailable' } }
      outcomes.push(String(args.p_status))
      return {
        data: {
          status: args.p_status,
          twilio_sid: args.p_sid,
          conversation_id: 'conversation',
          history_recorded: args.p_status === 'accepted',
        },
        error: null,
      }
    }),
  }
  return { db, outcomes }
}
describe('guarded first customer message', () => {
  it('sends only the claimed exact body and returns provider-confirmed durable history', async () => {
    const f = fixture(),
      send = vi.fn().mockResolvedValue({ sid })
    const result = await sendFirstCustomerMessage(
      f.db as never,
      'preview',
      'owner',
      send,
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0].slice(0, 2)).toEqual([
      '+17195550100',
      'Exact approved question',
    ])
    expect(result).toMatchObject({
      status: 'accepted',
      twilio_sid: sid,
      history_recorded: true,
    })
    await expect(
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ).rejects.toBeInstanceOf(FirstMessageOutcomeError)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('concurrent executors make at most one provider call', async () => {
    const f = fixture(),
      send = vi.fn().mockResolvedValue({ sid })
    const result = await Promise.allSettled([
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ])
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('records explicit Twilio rejection as failure without fake conversation success or automatic retry', async () => {
    const f = fixture(),
      send = vi.fn().mockRejectedValue({ status: 400, code: 21610 })
    await expect(
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ).rejects.toMatchObject({
      result: { status: 'rejected', history_recorded: false },
    })
    expect(f.outcomes).toEqual(['rejected'])
    await expect(
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ).rejects.toThrow('already exists')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('marks timeout and 5xx outcomes unknown and never retries the phone', async () => {
    for (const error of [new Error('timeout'), { status: 503, code: 20500 }]) {
      const f = fixture(),
        send = vi.fn().mockRejectedValue(error)
      await expect(
        sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
      ).rejects.toMatchObject({ result: { status: 'unknown' } })
      await expect(
        sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
      ).rejects.toThrow('already exists')
      expect(send).toHaveBeenCalledTimes(1)
    }
  })
  it('preserves accepted SID if atomic history finalization fails and cannot resend', async () => {
    const f = fixture(true),
      send = vi.fn().mockResolvedValue({ sid })
    await expect(
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ).rejects.toMatchObject({
      result: {
        status: 'accepted_history_pending',
        twilio_sid: sid,
        history_recorded: false,
      },
    })
    await expect(
      sendFirstCustomerMessage(f.db as never, 'preview', 'owner', send),
    ).rejects.toThrow('already exists')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('does not contact a provider when authorization, suppression or stale identity blocks the claim', async () => {
    const send = vi.fn(),
      db = {
        rpc: vi
          .fn()
          .mockResolvedValue({ error: { message: 'Contact suppressed' } }),
      }
    await expect(
      sendFirstCustomerMessage(db as never, 'preview', 'owner', send),
    ).rejects.toMatchObject({ message: 'Contact suppressed' })
    expect(send).not.toHaveBeenCalled()
  })
  it('only treats explicit provider rejections and known pre-send errors as certainly unsent', () => {
    expect(definitelyRejected({ status: 400, code: 21610 })).toBe(true)
    expect(
      definitelyRejected(new Error('Suppressed: customer is blacklisted')),
    ).toBe(true)
    expect(definitelyRejected({ status: 400 })).toBe(false)
    expect(definitelyRejected({ status: 503, code: 20500 })).toBe(false)
  })
})
