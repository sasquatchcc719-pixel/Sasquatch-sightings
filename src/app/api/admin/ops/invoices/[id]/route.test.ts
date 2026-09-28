// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  assertAccess: vi.fn(),
  db: vi.fn(),
  resyncInvoice: vi.fn(),
  syncAppointment: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAnyRole: mocks.access }))
vi.mock('@/supabase/server', () => ({ createAdminClient: mocks.db }))
vi.mock('@/lib/ops/tech-job-access', () => ({
  assertTechInvoiceAccess: mocks.assertAccess,
}))
vi.mock('@/lib/quickbooks-api', () => ({
  voidQBInvoice: vi.fn(),
  resyncInvoiceToQuickBooks: mocks.resyncInvoice,
  syncAppointmentToQuickBooks: mocks.syncAppointment,
}))
vi.mock('@/lib/ops/pdf/generate', () => ({ generateInvoicePDF: vi.fn() }))
vi.mock('@/lib/ops/quickbooks-sync-jobs', () => ({
  ensureInvoiceQuickBooksSyncJob: vi.fn(),
}))
vi.mock('@/lib/server/lead-sources', () => ({
  leadSourceUpdatePayload: vi.fn(),
  normalizeLeadSourceForWrite: vi.fn(),
}))
vi.mock('@/lib/blacklist', () => ({ isBlacklisted: vi.fn() }))
vi.mock('@/lib/ops/load-payment-texts', () => ({
  loadInvoicePaymentTexts: vi.fn(),
}))
vi.mock('@/lib/ops/invoice-loading', () => ({
  settleOptionalInvoiceLookup: vi.fn(),
}))

import { PATCH } from './route'

const context = { params: Promise.resolve({ id: 'invoice-a' }) }

type CurrentInvoice = {
  id: string
  appointment_id: string | null
  status: string
  payment_status: string
  payment_method: string | null
  quickbooks_invoice_id: string | null
  discount_amount: number
  discount_metadata: Record<string, unknown>
  percentage_discount_amount: number
  percentage_discount_label: string | null
  percentage_discount_percent: number
  percentage_discount_scope: string | null
  minimum_charge_adjustment: number
  tax_amount: number
  ops_invoice_line_items: unknown[]
}

let current: CurrentInvoice
let promo: Record<string, unknown>
let invoiceUpdate: Record<string, unknown> | null
let rpcCalls: Array<{ name: string; args: unknown }>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ id: 'owner-a', role: 'owner' })
  mocks.assertAccess.mockResolvedValue(undefined)
  invoiceUpdate = null
  rpcCalls = []
  current = {
    id: 'invoice-a',
    appointment_id: null,
    status: 'draft',
    payment_status: 'unpaid',
    payment_method: null,
    quickbooks_invoice_id: null,
    discount_amount: 0,
    discount_metadata: {},
    percentage_discount_amount: 0,
    percentage_discount_label: null,
    percentage_discount_percent: 0,
    percentage_discount_scope: null,
    minimum_charge_adjustment: 0,
    tax_amount: 0,
    ops_invoice_line_items: [],
  }
  promo = {
    id: 'promo-a',
    code: 'PARTNER10',
    discount_type: 'percent',
    discount_amount: 10,
    active: true,
    expires_at: null,
    max_uses: null,
    use_count: 0,
  }

  mocks.db.mockReturnValue({
    from: (table: string) => {
      let updatePayload: Record<string, unknown> | null = null
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn((payload: Record<string, unknown>) => {
          updatePayload = payload
          if (table === 'ops_invoices') invoiceUpdate = payload
          return builder
        }),
        single: vi.fn(async () => {
          if (table === 'ops_invoices' && updatePayload) {
            return { data: { ...current, ...updatePayload }, error: null }
          }
          return { data: current, error: null }
        }),
        maybeSingle: vi.fn(async () => ({ data: promo, error: null })),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({
            data:
              table === 'ops_invoice_line_items' ? [{ line_total: 566 }] : [],
            error: null,
          }).then(resolve),
      }
      return builder
    },
    rpc: vi.fn(async (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return { error: null }
    }),
  })
})

async function patchInvoice(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('https://example.com/api/admin/ops/invoices/invoice-a', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    context,
  )
}

describe('invoice coupon tracking', () => {
  it('recalculates a selected coupon on the server and stores its metadata', async () => {
    const response = await patchInvoice({
      promo_code: 'partner10',
      discount_amount: 0,
    })

    expect(response.status).toBe(200)
    expect(invoiceUpdate).toMatchObject({
      subtotal: 566,
      discount_amount: 56.6,
      total: 509.4,
      discount_metadata: {
        promo: {
          code: 'PARTNER10',
          type: 'percent',
          amount: 56.6,
          applied_subtotal: 566,
        },
      },
    })
    expect(rpcCalls).toEqual([
      {
        name: 'increment_promo_use_count',
        args: { promo_id: 'promo-a' },
      },
    ])
  })

  it('does not count the same coupon twice when the invoice is saved again', async () => {
    current.discount_amount = 56.6
    current.discount_metadata = {
      promo: { code: 'PARTNER10', amount: 56.6, applied_subtotal: 566 },
    }
    promo = {
      ...promo,
      active: false,
      expires_at: '2020-01-01T00:00:00.000Z',
      max_uses: 1,
      use_count: 1,
    }

    const response = await patchInvoice({ promo_code: 'PARTNER10' })

    expect(response.status).toBe(200)
    expect(invoiceUpdate).toMatchObject({ discount_amount: 56.6 })
    expect(rpcCalls).toEqual([])
  })

  it('clears coupon tracking when a manual dollar discount is saved', async () => {
    current.discount_metadata = {
      promo: { code: 'PARTNER10' },
      source: 'walkthrough',
    }

    const response = await patchInvoice({
      promo_code: null,
      discount_amount: 30,
    })

    expect(response.status).toBe(200)
    expect(invoiceUpdate).toMatchObject({
      discount_amount: 30,
      discount_metadata: { source: 'walkthrough' },
    })
    expect(
      (invoiceUpdate?.discount_metadata as Record<string, unknown>).promo,
    ).toBeUndefined()
    expect(rpcCalls).toEqual([])
  })
})
