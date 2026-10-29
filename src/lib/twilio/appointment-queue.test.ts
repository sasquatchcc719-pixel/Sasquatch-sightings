// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Twilio } from 'twilio'
import { dispatchAppointmentCall, queueWaitAudio } from './appointment-queue'

vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))
const queueSid = `QU${'1'.repeat(32)}`
const workerSid = `CA${'2'.repeat(32)}`

// Model atomic claims/binding, including simultaneous webhook requests.
function fixture({ size = 2, status = 'ringing', occupied = false } = {}) {
  const state = {
    queue_sid: queueSid,
    token: occupied ? 'old' : (null as string | null),
    worker_sid: occupied ? workerSid : (null as string | null),
    claimed_at: null,
  }
  const rpc = vi.fn(async (name, args) => {
    if (name === 'claim_appointment_dispatch') {
      if (state.token) return { data: false, error: null }
      state.token = args.p_token
      return { data: true, error: null }
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
    if (sid !== 'Front' && occupied)
      throw Object.assign(new Error('Not queued'), { status: 404 })
    return { callSid: workerSid }
  })
  const dequeue = vi.fn(async () => ({}))
  const members = vi.fn((sid: string) => ({
    fetch: () => fetchMember(sid),
    update: dequeue,
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
    dequeue,
    members,
    fetchMember,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TWILIO_PHONE_NUMBER', '+17195550101')
})

describe('appointment queue dispatch', () => {
  it('dequeues only the oldest caller across ten simultaneous queue polls', async () => {
    const f = fixture()
    await Promise.all(
      Array.from({ length: 10 }, () => dispatchAppointmentCall(f.db, f.client)),
    )
    expect(f.dequeue).toHaveBeenCalledOnce()
    expect(f.members).toHaveBeenCalledWith('Front')
    expect(f.members).toHaveBeenCalledWith(workerSid)
    expect(f.dequeue).toHaveBeenCalledWith({
      url: expect.stringContaining('/api/twilio/appointment-forward?token='),
      method: 'POST',
    })
    expect(f.state.worker_sid).toBe(workerSid)
    expect(f.create).not.toHaveBeenCalled()
  })
  it('keeps a long active conversation from starting another dial', async () => {
    const f = fixture({ occupied: true, status: 'in-progress' })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.dequeue).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('recovers a lost completed callback and rings the next waiting caller', async () => {
    const f = fixture({ occupied: true, status: 'completed' })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.dequeue).toHaveBeenCalledOnce()
  })
  it('does not ring an empty queue', async () => {
    const f = fixture({ size: 0 })
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.create).not.toHaveBeenCalled()
  })
  it('retries an uncertain dequeue only for the same caller and claim', async () => {
    const f = fixture()
    f.dequeue.mockRejectedValueOnce(new Error('Network timeout'))
    await expect(dispatchAppointmentCall(f.db, f.client)).rejects.toThrow(
      'Network timeout',
    )
    const token = f.state.token
    await dispatchAppointmentCall(f.db, f.client)
    expect(f.dequeue).toHaveBeenCalledTimes(2)
    expect(f.dequeue.mock.calls[0]).toEqual(f.dequeue.mock.calls[1])
    expect(f.state.token).toBe(token)
    expect(f.members).toHaveBeenLastCalledWith(workerSid)
    expect(f.create).not.toHaveBeenCalled()
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
