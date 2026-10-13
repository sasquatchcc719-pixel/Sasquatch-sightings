// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/quickbooks-auth', () => ({
  getValidQBAccessToken: vi.fn(async () => ({
    accessToken: 'test-token',
    realmId: 'test-realm',
  })),
  getQBConnectionStatus: vi.fn(async () => ({
    connected: true,
    sync_enabled: true,
  })),
}))
vi.mock('@/supabase/server', () => ({ createAdminClient: vi.fn() }))

import { createAdminClient } from '@/supabase/server'
import {
  excludeCashInvoiceFromQuickBooks,
  finalizeQuickBooksInvoiceSync,
  syncAppointmentToQuickBooks,
} from '@/lib/quickbooks-api'
import { ensureInvoiceQuickBooksSyncJob } from './quickbooks-sync-jobs'

type Invoice = {
  id: string
  status: string
  payment_method: string | null
  quickbooks_invoice_id: string | null
  sync_status: string
  ops_appointments: { kind: string }
}
let invoice: Invoice
let writes: Array<{ table: string; payload: Record<string, unknown> }>
let fetchMock: ReturnType<typeof vi.fn>

function database() {
  return {
    from(table: string) {
      let payload: Record<string, unknown> | undefined
      let nonCashOnly = false
      let applied = false
      function result() {
        if (
          payload &&
          !applied &&
          !(nonCashOnly && invoice.payment_method === 'cash')
        ) {
          applied = true
          writes.push({ table, payload })
          if (table === 'ops_invoices') Object.assign(invoice, payload)
        }
        return {
          data:
            nonCashOnly && invoice.payment_method === 'cash' ? null : invoice,
          error: null,
        }
      }
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        update: vi.fn((value: Record<string, unknown>) => {
          payload = value
          return builder
        }),
        or: vi.fn(() => {
          nonCashOnly = true
          return builder
        }),
        single: vi.fn(async () => result()),
        maybeSingle: vi.fn(async () => result()),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      }
      return builder
    },
  } as unknown as ReturnType<typeof createAdminClient>
}

beforeEach(() => {
  vi.clearAllMocks()
  invoice = {
    id: 'invoice-a',
    status: 'paid',
    payment_method: 'cash',
    quickbooks_invoice_id: null,
    sync_status: 'pending',
    ops_appointments: { kind: 'service' },
  }
  writes = []
  fetchMock = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          Invoice: {
            Id: 'qb-a',
            SyncToken: '1',
            ...(init?.method === 'POST' ? { PrivateNote: 'Voided' } : {}),
          },
        }),
        { status: 200 },
      ),
  )
  vi.stubGlobal('fetch', fetchMock)
})

describe('cash exclusion during QuickBooks sync', () => {
  it('voids the invoice created after cash was saved instead of marking it synced', async () => {
    const synced = await finalizeQuickBooksInvoiceSync(
      database(),
      invoice.id,
      'qb-a',
    )
    expect(synced).toBe(false)
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
    expect(invoice).toMatchObject({
      payment_method: 'cash',
      quickbooks_invoice_id: null,
      sync_status: 'held',
    })
    expect(
      writes.some(
        (w) => w.table === 'ops_invoices' && w.payload.sync_status === 'synced',
      ),
    ).toBe(false)
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: 'ops_quickbooks_sync_jobs',
        payload: expect.objectContaining({
          status: 'synced',
          next_retry_at: null,
          error_message: expect.stringContaining('cash'),
        }),
      }),
    )
  })

  it('cleans up when cash is saved after a sync has already linked the invoice', async () => {
    invoice.payment_method = 'square'
    const db = database()
    expect(await finalizeQuickBooksInvoiceSync(db, invoice.id, 'qb-a')).toBe(
      true,
    )
    invoice.payment_method = 'cash'
    expect(await ensureInvoiceQuickBooksSyncJob(db, invoice.id)).toMatchObject({
      queued: false,
      reason: 'cash payment',
    })
    expect(invoice).toMatchObject({
      quickbooks_invoice_id: null,
      sync_status: 'held',
    })
  })

  it('holds cash without a link and settles any stale queued invoice job', async () => {
    expect(
      await ensureInvoiceQuickBooksSyncJob(database(), invoice.id),
    ).toMatchObject({ queued: false })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invoice.sync_status).toBe('held')
    expect(writes.some((w) => w.table === 'ops_quickbooks_sync_jobs')).toBe(
      true,
    )
  })

  it('retains a late-created link when voiding fails so reconciliation can retry', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ Invoice: { SyncToken: '1' } })),
    )
    fetchMock.mockImplementationOnce(
      async () => new Response('unavailable', { status: 503 }),
    )
    const db = database()
    await expect(
      finalizeQuickBooksInvoiceSync(db, invoice.id, 'qb-a'),
    ).rejects.toThrow('QB void invoice failed')
    expect(invoice).toMatchObject({
      quickbooks_invoice_id: 'qb-a',
      sync_status: 'held',
    })
    expect(await excludeCashInvoiceFromQuickBooks(db, invoice.id)).toBe(true)
    expect(invoice.quickbooks_invoice_id).toBeNull()
  })

  it('clears a link to an invoice already voided in QuickBooks without voiding it again', async () => {
    invoice.quickbooks_invoice_id = 'qb-a'
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ Invoice: { PrivateNote: 'Voided', TotalAmt: 0 } }),
      ),
    )
    expect(await excludeCashInvoiceFromQuickBooks(database(), invoice.id)).toBe(
      true,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invoice.quickbooks_invoice_id).toBeNull()
  })

  it('does not mistake a manually entered void note for a voided invoice', async () => {
    invoice.quickbooks_invoice_id = 'qb-a'
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Invoice: { PrivateNote: 'Voided', TotalAmt: 472, SyncToken: '1' },
        }),
      ),
    )
    expect(await excludeCashInvoiceFromQuickBooks(database(), invoice.id)).toBe(
      true,
    )
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(1)
  })

  it.each([null, 'square', 'check', 'venmo'])(
    'still links eligible invoices paid by %s',
    async (method) => {
      invoice.payment_method = method
      expect(
        await finalizeQuickBooksInvoiceSync(database(), invoice.id, 'qb-a'),
      ).toBe(true)
      expect(invoice).toMatchObject({
        quickbooks_invoice_id: 'qb-a',
        sync_status: 'synced',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('stops direct appointment syncing when the saved invoice is cash', async () => {
    const db = database()
    const originalFrom = db.from.bind(db)
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      if (table !== 'ops_appointments') return originalFrom(table)
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({
          data: {
            id: 'appointment-a',
            kind: 'service',
            appointment_date: '2026-10-08',
            ops_customers: { id: 'customer-a', quickbooks_customer_id: '873' },
            ops_invoices: { ...invoice },
          },
          error: null,
        })),
      }
      return builder as unknown as ReturnType<typeof db.from>
    })
    vi.mocked(createAdminClient).mockReturnValue(db)
    await syncAppointmentToQuickBooks('appointment-a')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invoice.sync_status).toBe('held')
  })
})
