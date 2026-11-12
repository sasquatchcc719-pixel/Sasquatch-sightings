// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enqueueMissedCallEvent,
  missedCallStillEligible,
  MISSED_CALL_GRACE_MS,
  type FinalizedCall,
} from './missed-call-events'

const now = '2026-11-12T05:00:00.000Z'
const callSid = `CA${'2'.repeat(32)}`
const fresh: FinalizedCall = {
  callSid,
  phone: '+17195550100',
  outcome: 'no-answer',
  startedAt: '2026-11-12T04:59:00.000Z',
  endedAt: now,
}
function fixture() {
  const call: Record<string, any> = {
    call_sid: callSid,
    caller_phone: fresh.phone,
    direction: 'inbound',
    outcome: 'no-answer',
    recording_url: null,
    transcription: null,
    forwarding_accepted_at: null,
  }
  let subscriptions: Record<string, any>[] = [
    { id: 'subscription', created_at: '2026-11-12T04:58:00.000Z' },
  ]
  const writes: Record<string, any>[] = []
  const rpc = vi.fn().mockResolvedValue({ data: 'conversation', error: null })
  let error: object | null = null
  const from = (table: string) => {
    let since: string | null = null
    const q: any = {
      select: () => q,
      eq: () => q,
      or: () => q,
      lte: (_key: string, value: string) => {
        since = value
        return q
      },
      maybeSingle: () => Promise.resolve({ data: call, error }),
      upsert: async (rows: Record<string, any>[], options: any) => {
        expect(options).toEqual({
          onConflict: 'subscription_id,event_id',
          ignoreDuplicates: true,
        })
        rows.forEach((row) => {
          if (!writes.some((w) => w.id === row.id)) writes.push(row)
        })
        return { error }
      },
      then: (resolve: (v: any) => void) =>
        Promise.resolve({
          data: subscriptions.filter((s) => !since || s.created_at <= since),
          error,
        }).then(resolve),
    }
    return q
  }
  return {
    db: { from, rpc } as never,
    rpc,
    call,
    writes,
    setSubscriptions: (v: typeof subscriptions) => (subscriptions = v),
    fail: () => {
      error = { message: 'DB unavailable' }
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())
describe('future-only missed-call event', () => {
  it('persists one delayed event for the exact call, with stable retry identity', async () => {
    const f = fixture()
    expect(await enqueueMissedCallEvent(f.db, fresh)).toBe(1)
    expect(await enqueueMissedCallEvent(f.db, fresh)).toBe(1)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({
      event_name: 'call.missed',
      occurred_at: fresh.startedAt,
      payload: { call_sid: callSid, conversation_id: 'conversation' },
      next_attempt_at: new Date(
        Date.parse(now) + MISSED_CALL_GRACE_MS,
      ).toISOString(),
    })
  })
  it('does not create context or events for calls predating subscription or without subscribers', async () => {
    const f = fixture()
    f.setSubscriptions([{ id: 'new', created_at: now }])
    expect(await enqueueMissedCallEvent(f.db, fresh)).toBe(0)
    f.setSubscriptions([])
    expect(await enqueueMissedCallEvent(f.db, fresh)).toBe(0)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { outcome: 'answered' },
    { outcome: 'voicemail' },
    { outcome: 'blacklisted' },
    { recording_url: 'recording' },
    { transcription: 'A message' },
    { forwarding_accepted_at: now },
    { direction: 'outbound' },
    { caller_phone: 'anonymous' },
  ])('suppresses a noneligible or newly handled call %o', async (patch) => {
    const f = fixture()
    Object.assign(f.call, patch)
    expect(await enqueueMissedCallEvent(f.db, fresh)).toBe(0)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('fails closed for missing timestamps, stale calls and provider identities', async () => {
    const f = fixture()
    for (const patch of [
      { startedAt: null },
      { endedAt: null },
      { startedAt: '2026-10-30T00:00:00Z' },
      { callSid: 'fake' },
    ])
      expect(await enqueueMissedCallEvent(f.db, { ...fresh, ...patch })).toBe(0)
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('does not turn database failures into eligible calls', async () => {
    const f = fixture()
    f.fail()
    await expect(
      missedCallStillEligible(f.db, callSid, fresh.startedAt!),
    ).rejects.toMatchObject({ message: 'DB unavailable' })
  })
})
