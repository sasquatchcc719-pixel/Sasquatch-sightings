// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  db: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/communications', () => ({
  sendOpsLifecycleCommunications: mocks.send,
}))
import { POST } from './route'

const context = { params: Promise.resolve({ id: 'estimate-a' }) }
const request = (undo = false) =>
  new NextRequest('http://localhost/api/estimate/on-my-way', {
    method: 'POST',
    body: JSON.stringify({ undo }),
  })
let current: Record<string, unknown>
let updated: { id: string } | null
let update: ReturnType<typeof vi.fn>
let filters: unknown[][]
beforeEach(() => {
  vi.clearAllMocks()
  current = {
    id: 'estimate-a',
    status: 'confirmed',
    on_my_way_at: null,
    converted_appointment_id: null,
  }
  updated = { id: 'estimate-a' }
  filters = []
  mocks.access.mockResolvedValue({ id: 'owner-a' })
  mocks.send.mockResolvedValue({
    sent: [
      {
        channel: 'sms',
        actually_sent: true,
        body: 'Charles is on the way to your estimate.',
      },
    ],
  })
  let writing = false
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((...args: unknown[]) => {
      filters.push(args)
      return builder
    }),
    is: vi.fn((...args: unknown[]) => {
      filters.push(args)
      return builder
    }),
    maybeSingle: vi.fn(async () => ({
      data: writing ? updated : current,
      error: null,
    })),
    update: vi.fn(() => {
      writing = true
      return builder
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  }
  update = builder.update
  mocks.db.mockReturnValue({ from: () => builder })
})

describe('estimate on-my-way action', () => {
  it('requires an authorized staff session', async () => {
    mocks.access.mockRejectedValue(new Error('Not authorized'))
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.db).not.toHaveBeenCalled()
  })
  it('changes the estimate status and confirms a successful send', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      status: 'on_my_way',
      sms: { body: expect.any(String) },
      warning: null,
    })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'on_my_way',
        on_my_way_at: expect.any(String),
      }),
    )
    expect(filters).toContainEqual(['kind', 'estimate'])
    expect(filters).toContainEqual(['status', 'confirmed'])
    expect(filters).toContainEqual(['converted_appointment_id', null])
    expect(mocks.send).toHaveBeenCalledOnce()
  })
  it('warns when no text was sent (missing phone, disabled template or suppression)', async () => {
    mocks.send.mockResolvedValue({ sent: [] })
    expect(await (await POST(request(), context)).json()).toMatchObject({
      status: 'on_my_way',
      sms: null,
      warning: expect.stringContaining('no customer text was sent'),
    })
  })
  it('does not describe a preview as a sent message', async () => {
    mocks.send.mockResolvedValue({
      sent: [{ channel: 'sms', body: 'Preview', actually_sent: false }],
    })
    expect(await (await POST(request(), context)).json()).toMatchObject({
      sms: null,
      warning: expect.any(String),
    })
  })
  it('reports SMS failure separately from the saved travel status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.send.mockRejectedValue(new Error('Twilio rejected the message'))
    expect(await (await POST(request(), context)).json()).toMatchObject({
      status: 'on_my_way',
      sms: null,
      warning: expect.stringContaining('could not be confirmed'),
    })
    spy.mockRestore()
  })
  it('does not send again for an already-on-the-way estimate', async () => {
    current.status = 'on_my_way'
    expect((await POST(request(), context)).status).toBe(200)
    expect(update).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('does not send when a competing request changed the visit', async () => {
    updated = null
    expect((await POST(request(), context)).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it.each(['completed', 'cancelled', 'in_progress'])(
    'blocks a %s visit',
    async (status) => {
      current.status = status
      expect((await POST(request(), context)).status).toBe(409)
      expect(update).not.toHaveBeenCalled()
      expect(mocks.send).not.toHaveBeenCalled()
    },
  )
  it('blocks a converted estimate', async () => {
    current.converted_appointment_id = 'service-a'
    expect((await POST(request(), context)).status).toBe(409)
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('undoes travel status without sending a text', async () => {
    current.status = 'on_my_way'
    expect((await POST(request(true), context)).status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', on_my_way_at: null }),
    )
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
