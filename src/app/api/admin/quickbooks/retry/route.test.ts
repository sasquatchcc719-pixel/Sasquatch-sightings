import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  status: vi.fn(),
  sync: vi.fn(),
  queue: vi.fn(),
  confirmed: {
    quickbooks_invoice_id: 'qb-1',
    sync_status: 'synced',
    status: 'paid',
    payment_method: 'square',
  } as Record<string, unknown>,
}))
vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.auth }))
vi.mock('@/lib/quickbooks-api', () => ({
  syncAppointmentToQuickBooks: mocks.sync,
}))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureInvoiceQuickBooksSyncJob: mocks.queue,
}))
vi.mock('@/lib/quickbooks-auth', () => ({
  getQBConnectionStatus: mocks.status,
  QB_RECONNECT_MESSAGE: 'Reconnect QuickBooks.',
  QuickBooksTokenError: class extends Error {},
}))
vi.mock('@/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => {
      let confirming = false
      const q: any = {
        select: (columns: string) => {
          confirming = columns.includes('quickbooks_invoice_id')
          return q
        },
        eq: () => q,
        maybeSingle: async () => ({
          data: confirming
            ? mocks.confirmed
            : { id: 'invoice', appointment_id: 'appointment' },
          error: null,
        }),
      }
      return q
    },
  }),
}))
import { POST } from './route'
const request = () =>
  new NextRequest('https://example.test/api/admin/quickbooks/retry', {
    method: 'POST',
    body: JSON.stringify({ invoice_id: 'invoice' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({})
  mocks.status.mockResolvedValue({ connected: true, sync_enabled: true })
  mocks.queue.mockResolvedValue({ queued: true, status: 'pending' })
  mocks.sync.mockResolvedValue(undefined)
  mocks.confirmed = {
    quickbooks_invoice_id: 'qb-1',
    sync_status: 'synced',
    status: 'paid',
    payment_method: 'square',
  }
})

describe('invoice redeploy recovery', () => {
  it('returns an actionable reconnect response without resetting or attempting an invoice', async () => {
    mocks.status.mockResolvedValue({
      connected: false,
      reconnect_required: true,
    })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      reconnect_required: true,
      error: 'Reconnect QuickBooks.',
    })
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.sync).not.toHaveBeenCalled()
  })
  it('preserves a real invoice collision error instead of hiding it', async () => {
    mocks.sync.mockRejectedValue(
      new Error('QB invoice DocNumber collision: SASQ-18889'),
    )
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('DocNumber collision')
  })
  it('reports a temporary outage as queued for automatic retry', async () => {
    mocks.sync.mockRejectedValue(new Error('network timeout'))
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      queued: true,
      status: 'pending',
    })
  })
  it('reports synced only after the immediate sync succeeds', async () => {
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ status: 'synced' })
    expect(mocks.sync).toHaveBeenCalledWith('appointment')
  })

  it('does not report success when the helper resolves without persisting the requested invoice', async () => {
    mocks.confirmed = {
      quickbooks_invoice_id: null,
      sync_status: 'pending',
      status: 'paid',
    }
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      status: 'pending',
      queued: true,
    })
  })
})
