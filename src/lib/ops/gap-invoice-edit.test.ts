// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateReturningInvoiceEdit } from './gap-invoice-edit'
const current = {
  discount_amount: 35,
  discount_metadata: {
    promo: { code: 'TF35', amount: 35 },
    gap_offer: { minimum_service_cents: 30000 },
  },
  ops_invoice_line_items: [
    {
      id: 'line',
      service_catalog_item_id: 'carpet',
      quantity: 1,
      unit_price: 300,
      line_total: 300,
    },
  ],
}
function db() {
  const reads = vi.fn((table: string) => ({
    select: () => ({
      in: async () => ({
        data:
          table === 'service_catalog_items'
            ? [
                {
                  id: 'carpet',
                  name: 'Carpet',
                  category: 'Carpet Cleaning',
                  slug: 'carpet',
                  is_active: true,
                },
                {
                  id: 'travel',
                  name: 'Mileage/ Travel',
                  category: 'Travel',
                  slug: 'mileage-travel',
                  is_active: true,
                },
              ]
            : [],
        error: null,
      }),
    }),
  }))
  return { client: { from: reads } as unknown as SupabaseClient, reads }
}
describe('returning-offer invoice validation before mutations', () => {
  it('rejects below-threshold edits before any route can mutate lines or contacts', async () => {
    const f = db()
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        line_items: [
          { id: 'line', quantity: 1, unit_price: 280 },
          {
            id: 'new-travel',
            service_catalog_item_id: 'travel',
            quantity: 1,
            unit_price: 50,
          },
        ],
      }),
    ).rejects.toThrow('no longer qualifies')
    expect(
      f.reads.mock.calls.every(([table]) =>
        ['service_catalog_items', 'ops_appointment_line_items'].includes(table),
      ),
    ).toBe(true)
  })
  it('retains exactly-$300 eligibility and prevents a duplicate-ID projection', async () => {
    const f = db()
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        line_items: [{ id: 'line', quantity: 1, unit_price: 300 }],
      }),
    ).resolves.toBeUndefined()
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        line_items: [
          { id: 'line', quantity: 1, unit_price: 150 },
          { id: 'line', quantity: 1, unit_price: 150 },
        ],
      }),
    ).rejects.toThrow('Duplicate')
  })
  it('ignores submitted replacement catalog identity on an existing line', async () => {
    const f = db()
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        line_items: [
          {
            id: 'line',
            service_catalog_item_id: 'travel',
            quantity: 1,
            unit_price: 300,
          },
        ],
      }),
    ).resolves.toBeUndefined()
  })
  it('explicit coupon removal can lower the subtotal without retaining TF35', async () => {
    const f = db()
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        promo_code: '',
        discount_amount: 0,
        line_items: [{ id: 'line', quantity: 1, unit_price: 175 }],
      }),
    ).resolves.toBeUndefined()
  })
  it('rejects bare TF35 application, stacking, negative credits and excluded-line inflation', async () => {
    const f = db()
    await expect(
      validateReturningInvoiceEdit(
        f.client,
        { discount_metadata: {} },
        { promo_code: 'TF35' },
      ),
    ).rejects.toThrow('approved')
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        percentage_discount_amount: 10,
      }),
    ).rejects.toThrow('combine')
    await expect(
      validateReturningInvoiceEdit(f.client, current, {
        line_items: [{ id: 'line', quantity: 1, unit_price: -300 }],
      }),
    ).rejects.toThrow('credit')
    await expect(
      validateReturningInvoiceEdit(
        f.client,
        {
          ...current,
          ops_invoice_line_items: [
            { ...current.ops_invoice_line_items[0], excluded_at: 'excluded' },
          ],
        },
        { line_items: [{ id: 'line', quantity: 1, unit_price: 1000 }] },
      ),
    ).rejects.toThrow('no longer qualifies')
  })
})
