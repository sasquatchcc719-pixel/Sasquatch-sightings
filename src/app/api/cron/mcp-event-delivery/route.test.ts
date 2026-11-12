import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { enqueue, deliver, deliverEmails, db } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  deliver: vi.fn(),
  deliverEmails: vi.fn(),
  db: {},
}))
vi.mock('@/lib/mcp/inbound-events', () => ({
  enqueuePersistedInboundEvents: enqueue,
  deliverPendingMcpEvents: deliver,
}))
vi.mock('@/lib/mcp/missed-call-email-bridge', () => ({
  deliverPendingMissedCallEmails: deliverEmails,
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: () => db }))
import { GET } from './route'

function request(secret = 'cron-test') {
  return new NextRequest(
    'https://sightings.sasquatchcarpet.com/api/cron/mcp-event-delivery',
    { headers: { authorization: `Bearer ${secret}` } },
  )
}

describe('MCP and missed-call owner-email delivery cron', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-test')
    enqueue.mockReset().mockResolvedValue(2)
    deliver.mockReset().mockResolvedValue(1)
    deliverEmails.mockReset().mockResolvedValue({
      accepted: 1,
      suppressed: 0,
      rejected: 0,
      unknown: 0,
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('runs both independent workers and reports both outcomes', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      enqueued: 2,
      delivered: 1,
      missed_call_emails: {
        accepted: 1,
        suppressed: 0,
        rejected: 0,
        unknown: 0,
      },
    })
    expect(deliverEmails).toHaveBeenCalledWith({ db })
  })

  it('still runs the owner-email worker when the native MCP queue fails', async () => {
    enqueue.mockRejectedValue(new Error('native queue unavailable'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(deliverEmails).toHaveBeenCalledWith({ db })
    expect((await response.json()).missed_call_emails).toBe('fulfilled')
  })

  it('still runs the native MCP worker when the owner-email worker fails', async () => {
    deliverEmails.mockRejectedValue(new Error('email queue unavailable'))
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(enqueue).toHaveBeenCalledWith(db)
    expect(deliver).toHaveBeenCalledWith({ supabase: db })
    expect((await response.json()).native_events).toBe('fulfilled')
  })

  it('rejects an unauthenticated cron request before running either worker', async () => {
    expect((await GET(request('wrong'))).status).toBe(401)
    expect(enqueue).not.toHaveBeenCalled()
    expect(deliverEmails).not.toHaveBeenCalled()
  })
})
