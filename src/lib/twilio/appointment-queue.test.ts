// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'
import { dispatchAppointmentCall, queueWaitAudio } from './appointment-queue'

vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('./call-routing-config', () => ({
  getCallRoutingConfig: vi.fn(async () => ({
    primaryForwardNumber: '+17205550100',
    secondaryForwardNumber: '+17195550101',
    ivrScheduleTimeoutSeconds: 30,
  })),
}))
const queueSid = `QU${'1'.repeat(32)}`
const workerSid = `CA${'2'.repeat(32)}`
const callerSid = `CA${'3'.repeat(32)}`

// Model atomic claims/binding, including simultaneous webhook requests.
function fixture({
  size = 2,
  status = 'ringing',
  occupied = false,
  stage = 'primary',
  accepted = false,
} = {}) {
  const state = {
    queue_sid: queueSid,
    token: occupied ? 'old' : (null as string | null),
    worker_sid: occupied ? workerSid : (null as string | null),
    caller_sid: occupied ? callerSid : (null as string | null),
    stage,
    accepted,
    claimed_at: occupied ? new Date().toISOString() : (null as string | null),
  }
  const rpc = vi.fn(async (name, args) => {
    if (name === 'claim_appointment_dispatch_v2') {
      if (state.token) return { data: false, error: null }
      state.token = args.p_token
      state.caller_sid = args.p_caller_sid
      state.stage = args.p_stage
      state.accepted = false
      state.claimed_at = new Date().toISOString()
      return { data: true, error: null }
    }
    if (name === 'advance_appointment_dispatch') {
      const ok =
        state.token === args.p_token &&
        state.worker_sid === args.p_worker_sid &&
        state.stage === 'primary' &&
        !state.accepted
      if (ok) {
        state.token = args.p_next_token
        state.worker_sid = null
        state.stage = 'secondary'
      }
      return { data: ok, error: null }
    }
    if (name === 'accept_appointment_dispatch') {
      const ok =
        state.token === args.p_token && state.worker_sid === args.p_worker_sid
      if (ok) state.accepted = true
      return { data: ok, error: null }
    }
    const ok =
      state.token === args.p_token &&
      (!state.worker_sid || state.worker_sid === args.p_worker_sid)
    if (ok) state.worker_sid = args.p_worker_sid
    return { data: ok, error: null }
  })
  const filters: Record<string, unknown> = {}
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((key, value) => {
      filters[key] = value
      return query
    }),
    single: vi.fn(async () => ({ data: { ...state }, error: null })),
    then: (resolve: (value: unknown) => void) => {
      if (
        state.token === filters.token &&
        state.worker_sid === filters.worker_sid
      ) {
        state.token = null
        state.worker_sid = null
        state.caller_sid = null
        state.stage = 'primary'
        state.accepted = false
        state.claimed_at = null
      }
      resolve({ error: null })
    },
    update: vi.fn(() => query),
  }
  const db = { from: vi.fn(() => query), rpc } as unknown as SupabaseClient
  const create = vi.fn(async () => ({ sid: workerSid }))
  const fetchWorker = vi.fn(async () => ({ status }))
  const updateWorker = vi.fn(async () => ({}))
  const calls = Object.assign(
    vi.fn(() => ({ fetch: fetchWorker, update: updateWorker })),
    { create },
  )
  const fetchQueue = vi.fn(async () => ({ currentSize: size }))
  const fetchMember = vi.fn(async (sid: string) => {
    if (sid !== 'Front' && sid !== callerSid)
      throw Object.assign(new Error('Not queued'), { status: 404 })
    return { callSid: callerSid }
  })
  const redirect = vi.fn(async () => ({}))
  const members = vi.fn((sid: string) => ({
    fetch: () => fetchMember(sid),
    update: redirect,
  }))
  const client = {
    queues: vi.fn(() => ({ fetch: fetchQueue, members })),
    calls,
  } as unknown as Twilio
  return {
    state,
    db,
    client,
    create,
    rpc,
    fetchWorker,
    updateWorker,
    redirect,
    members,
    fetchMember,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+17195550101')
})

describe('appointment queue dispatch', () => {
  it('rings one primary phone while the oldest caller remains queued on music', async () => {
    const f = fixture()
    await Promise.all(
      Array.from({ length: 10 }, () => dispatchAppointmentCall(f.db, f.client)),
    )
    expect(f.create).toHaveBeenCalledOnce()
    expect(f.members).toHaveBeenCalledWith('Front')
    expect(f.redirect).not.toHaveBeenCalled()
    expect(f.create).toHaveBeenCalledWith({
      to: '+17205550100',
      from: '+17195550101',
      timeout: 30,
      url: expect.stringContaining('/api/twilio/appointment-agent?token='),
      method: 'POST',
      statusCallback: expect.stringContaining('event=status'),
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed'],
    })
    expect(f.state.worker_sid).toBe(workerSid)
    expect(f.state.caller_sid).toBe(callerSid)
  })
  it('keeps a long active conversation from starting another dial', async () => {
    const f = fixture({ occupied: true, status: 'in-progress' })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.redirect).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('recovers a missed callback and rings the secondary phone', async () => {
    const f = fixture({ occupied: true, status: 'completed' })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+17195550101' }),
    )
    expect(f.state.stage).toBe('secondary')
    expect(f.state.caller_sid).toBe(callerSid)
    expect(f.redirect).not.toHaveBeenCalled()
  })
  it('releases an accepted call without ringing the secondary phone', async () => {
    const f = fixture({ occupied: true, status: 'completed', accepted: true })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.create).not.toHaveBeenCalled()
    expect(f.state.token).toBeNull()
  })
  it('sends the exact caller to voicemail after the secondary misses', async () => {
    const f = fixture({
      occupied: true,
      status: 'completed',
      stage: 'secondary',
    })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.members).toHaveBeenCalledWith(callerSid)
    expect(f.redirect).toHaveBeenCalledWith({
      url: expect.stringContaining('/api/twilio/call-after-hours'),
      method: 'POST',
    })
    expect(f.state.token).toBeNull()
  })
  it('does not ring an empty queue', async () => {
    const f = fixture({ size: 0 })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.create).not.toHaveBeenCalled()
  })
  it('leaves the caller queued if starting the screened phone call fails', async () => {
    const f = fixture()
    f.create.mockRejectedValueOnce(new Error('Network timeout'))
    await expect(dispatchAppointmentCall(f.db, f.client)).rejects.toThrow(
      'Network timeout',
    )
    expect(f.redirect).not.toHaveBeenCalled()
    expect(f.state.caller_sid).toBe(callerSid)
  })
  it('does not release a busy dispatcher when provider status is unavailable', async () => {
    const f = fixture({ occupied: true })
    f.fetchWorker.mockRejectedValueOnce(new Error('Provider unavailable'))
    await expect(dispatchAppointmentCall(f.db, f.client)).rejects.toThrow()
    expect(f.create).not.toHaveBeenCalled()
  })
})

describe('per-caller queue timer', () => {
  it('plays music while time remains', () => {
    expect(queueWaitAudio('https://example.com', 0)).toContain(
      'appointment-hold.mp3',
    )
    expect(queueWaitAudio('https://example.com', 172)).toContain('<Play>')
  })
  it('shortens the last wait and exits at three minutes', () => {
    expect(queueWaitAudio('https://example.com', 176)).toBe(
      '<Pause length="4"/>',
    )
    expect(queueWaitAudio('https://example.com', 179)).toBe(
      '<Pause length="1"/>',
    )
    expect(queueWaitAudio('https://example.com', 180)).toBe('<Leave/>')
    expect(queueWaitAudio('https://example.com', 181)).toBe('<Leave/>')
  })
  it.each([NaN, -1, Infinity])(
    'rejects invalid provider time %s',
    (elapsed) => {
      expect(() => queueWaitAudio('https://example.com', elapsed)).toThrow()
    },
  )
})
