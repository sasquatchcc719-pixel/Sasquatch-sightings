import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  discountedEligibleRevenue,
  isNewQualifyingServiceCategory,
  qualifyingAddOnCategory,
  loadAddOnBonuses,
  invoiceBonusRevenue,
  invoiceGrowthRevenue,
  usesInvoiceGrowthBonus,
  captureAddOnBonusBaseline,
} from './add-on-bonuses'

describe('qualifyingAddOnCategory', () => {
  it('recognizes the four bonus service categories', () => {
    expect(
      qualifyingAddOnCategory('Carpet Cleaning', 'Regular Size Room'),
    ).toBe('carpet_cleaning')
    expect(
      qualifyingAddOnCategory('Hard Surface', 'Tile & grout cleaning'),
    ).toBe('tile_and_grout')
    expect(qualifyingAddOnCategory('rug cleaning', 'Area Rug 5x8')).toBe(
      'rug_cleaning',
    )
    expect(qualifyingAddOnCategory('Upholstery Cleaning', 'Sofa / Couch')).toBe(
      'upholstery_cleaning',
    )
  })

  it('does not turn fees or ancillary carpet treatments into bonuses', () => {
    expect(qualifyingAddOnCategory('Carpet Cleaning', 'Card fee')).toBeNull()
    expect(
      qualifyingAddOnCategory('Carpet Cleaning', 'Urine Eliminator Treatment'),
    ).toBeNull()
    expect(
      qualifyingAddOnCategory('Hard Surface', 'Auto scrubbing Floors'),
    ).toBeNull()
  })

  it('rejects more work in the original category but accepts a new category', () => {
    const baseline = ['carpet_cleaning'] as const
    expect(isNewQualifyingServiceCategory('carpet_cleaning', baseline)).toBe(
      false,
    )
    expect(
      isNewQualifyingServiceCategory('upholstery_cleaning', baseline),
    ).toBe(true)
  })
})

describe('loadAddOnBonuses', () => {
  function database(
    appointmentCount: number,
    errorTable?: string,
    bonusCount = 1,
    growth?: { baseline: number; paymentStatus?: string; staffUserId?: string },
  ) {
    const appointments = Array.from(
      { length: appointmentCount },
      (_, index) => ({
        id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        appointment_date: '2026-10-06',
        ops_customers: { full_name: 'Customer', business_name: null },
        ...(growth
          ? {
              invoice_growth_baseline_total: growth.baseline,
              invoice_growth_bonus_staff_user_id: growth.staffUserId || 'tech',
              invoice_growth_bonus_rate: 0.1,
            }
          : {}),
      }),
    )
    const bonusAppointment = appointments[appointmentCount - 1].id
    const bonusAppointments = new Set(
      appointments.slice(-bonusCount).map((appointment) => appointment.id),
    )
    const filters: { table: string; ids: string[] }[] = []
    const from = vi.fn((table: string) => {
      let ids: string[] = []
      let rangeStart = 0
      let rangeEnd = 999
      const query = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        range: (start: number, end: number) => {
          rangeStart = start
          rangeEnd = end
          return query
        },
        in: (_field: string, values: string[]) => {
          ids = values
          filters.push({ table, ids })
          return query
        },
        then: (resolve: (value: unknown) => unknown) => {
          const failed = table === errorTable || ids.length > 50
          const data =
            table === 'ops_appointments'
              ? appointments.slice(rangeStart, rangeEnd + 1)
              : table === 'ops_appointment_line_items'
                ? ids
                    .filter((id) => bonusAppointments.has(id))
                    .map((id) => ({
                      id: `line-${id}`,
                      appointment_id: id,
                      line_total: 70,
                      add_on_bonus_staff_user_id: 'tech',
                      add_on_bonus_category: 'rug_cleaning',
                      add_on_bonus_rate: 0.1,
                    }))
                : table === 'staff_users'
                  ? [{ id: 'tech', display_name: 'David' }]
                  : ids.map((id) => ({
                      id: `invoice-${id}`,
                      appointment_id: id,
                      payment_status: growth?.paymentStatus || 'paid',
                      subtotal: 346,
                      discount_amount: 20,
                      percentage_discount_amount: 0,
                      created_at: '2026-10-06',
                    }))
          return Promise.resolve({
            data: failed ? null : data,
            error: failed ? new Error('Query failed or URL too long') : null,
          }).then(resolve)
        },
      }
      return query
    })
    return {
      client: { from } as unknown as SupabaseClient,
      filters,
      bonusAppointment,
    }
  }

  it.each([451, 1051])(
    'loads all bonuses across %i appointments without oversized GET filters',
    async (count) => {
      const { client, filters, bonusAppointment } = database(count)
      const summary = await loadAddOnBonuses(client, {
        startDate: '2026-01-01',
        endDate: '2026-10-07',
      })
      expect(summary.earnedBonus).toBe(6.6)
      expect(summary.rows).toHaveLength(1)
      expect(filters.every((filter) => filter.ids.length <= 50)).toBe(true)
      expect(
        filters
          .filter((filter) => filter.table === 'ops_appointment_line_items')
          .flatMap((filter) => filter.ids),
      ).toHaveLength(count)
      expect(
        filters
          .filter((filter) => filter.table === 'ops_invoices')
          .flatMap((filter) => filter.ids),
      ).toEqual([bonusAppointment])
    },
  )

  it('also bounds invoice requests when more than 50 appointments earned a bonus', async () => {
    const { client, filters } = database(451, undefined, 61)
    const summary = await loadAddOnBonuses(client, {
      startDate: '2026-01-01',
      endDate: '2026-10-07',
    })
    expect(summary.rows).toHaveLength(61)
    expect(summary.earnedBonus).toBe(402.6)
    const invoiceFilters = filters.filter(
      (filter) => filter.table === 'ops_invoices',
    )
    expect(invoiceFilters.map((filter) => filter.ids.length)).toEqual([50, 11])
  })

  it.each(['paid', 'unpaid'])(
    'replaces category bonuses with one invoice-growth bonus (%s)',
    async (paymentStatus) => {
      const { client } = database(1, undefined, 1, {
        baseline: 226,
        paymentStatus,
      })
      const summary = await loadAddOnBonuses(client, {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      })
      expect(summary.rows).toHaveLength(1)
      expect(summary.rows[0]).toMatchObject({
        category: 'invoice_growth',
        eligibleRevenue: 100,
        bonusAmount: 10,
        status: paymentStatus === 'paid' ? 'earned' : 'pending',
      })
      expect(summary.earnedBonus).toBe(paymentStatus === 'paid' ? 10 : 0)
      expect(summary.pendingBonus).toBe(paymentStatus === 'paid' ? 0 : 10)
    },
  )

  it('counts increased quantities even when no new category line was attributed', async () => {
    const { client } = database(1, undefined, 0, { baseline: 226 })
    const summary = await loadAddOnBonuses(client, {
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      staffUserId: 'tech',
    })
    expect(summary.earnedBonus).toBe(10)
  })

  it('does not pay for a reduced invoice or pay another technician', async () => {
    for (const growth of [
      { baseline: 400 },
      { baseline: 226, staffUserId: 'other' },
    ]) {
      const { client } = database(1, undefined, 0, growth)
      const summary = await loadAddOnBonuses(client, {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        staffUserId: 'tech',
      })
      expect(summary.rows).toEqual([])
      expect(summary.earnedBonus).toBe(0)
    }
  })

  it('does not turn a failed bonus batch into zero payroll', async () => {
    await expect(
      loadAddOnBonuses(database(451, 'ops_appointment_line_items').client, {
        startDate: '2026-01-01',
        endDate: '2026-10-07',
      }),
    ).rejects.toThrow('Query failed')
  })
})

describe('discountedEligibleRevenue', () => {
  it('prorates invoice discounts before calculating the bonus base', () => {
    expect(discountedEligibleRevenue(150, 500, 50, 0)).toBe(135)
    expect(discountedEligibleRevenue(150, 500, 0, 50)).toBe(135)
  })
})

describe('invoice growth policy', () => {
  it('switches on the configured work date, regardless of when payroll is viewed', () => {
    expect(usesInvoiceGrowthBonus('2026-10-24', '2026-10-25')).toBe(false)
    expect(usesInvoiceGrowthBonus('2026-10-25', '2026-10-25')).toBe(true)
    expect(usesInvoiceGrowthBonus('2026-11-11', '2026-10-25')).toBe(true)
    expect(usesInvoiceGrowthBonus('2026-11-11', null)).toBe(false)
    expect(usesInvoiceGrowthBonus('2026-11-10', '2026-11-11')).toBe(false)
  })

  it('compares discounted revenue and preserves the original minimum charge', () => {
    expect(
      invoiceBonusRevenue({
        subtotal: 400,
        discount_amount: 40,
        percentage_discount_amount: 20,
        minimum_charge_adjustment: 10,
      }),
    ).toBe(350)
    expect(invoiceGrowthRevenue(300, 400)).toBe(100)
    expect(invoiceGrowthRevenue(300, 250)).toBe(0)
    expect(invoiceGrowthRevenue(0, 0)).toBe(0)
    expect(invoiceGrowthRevenue(300.1, 400.2)).toBe(100.1)
  })

  it('adding only a tip never increases the bonus with a flat discount', () => {
    const before = invoiceBonusRevenue({
      subtotal: 400,
      discount_amount: 40,
      percentage_discount_amount: 0,
    })
    const after = invoiceBonusRevenue({
      subtotal: 440,
      discount_amount: 40,
      percentage_discount_amount: 0,
      ops_invoice_line_items: [
        {
          description: 'Gratuity',
          line_total: 40,
          excluded_at: null,
          service_catalog_items: null,
        },
      ],
    })
    expect(before).toBe(360)
    expect(after).toBe(before)
  })

  it('excludes gratuity and fees, including catalog-free legacy descriptions', () => {
    const invoice = {
      subtotal: 460,
      discount_amount: 46,
      percentage_discount_amount: 0,
      ops_invoice_line_items: [
        {
          description: 'Cleaning',
          line_total: 400,
          excluded_at: null,
          service_catalog_items: null,
        },
        {
          description: 'Customer thank you',
          line_total: 40,
          excluded_at: null,
          service_catalog_items: [{ name: 'Gratuity', slug: 'gratuity' }],
        },
        {
          description: 'Card fee',
          line_total: 20,
          excluded_at: null,
          service_catalog_items: null,
        },
      ],
    }
    expect(invoiceBonusRevenue(invoice)).toBe(354)
    expect(invoiceGrowthRevenue(354, invoiceBonusRevenue(invoice))).toBe(0)
  })
})

describe('captureAddOnBonusBaseline', () => {
  function baselineDatabase(
    captured = false,
    startsOn: string | null = '2026-10-25',
    hasInvoice = true,
  ) {
    let saved: Record<string, unknown> | null = null
    const from = vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn((value: Record<string, unknown>) => {
          saved = value
          return query
        }),
        single: vi.fn(async () => ({
          data: {
            commission_baseline_captured_at: captured
              ? '2026-10-25T12:00:00Z'
              : null,
            add_on_bonus_baseline_categories: ['carpet_cleaning'],
            appointment_date: '2026-10-25',
            assigned_staff_user_id: 'tech',
            assigned_staff: {
              add_on_bonus_rate: 0.1,
              invoice_growth_bonus_starts_on: startsOn,
            },
          },
          error: null,
        })),
        maybeSingle: vi.fn(async () => ({
          data:
            table === 'ops_invoices'
              ? hasInvoice
                ? {
                    subtotal: 400,
                    discount_amount: 40,
                    percentage_discount_amount: 0,
                    minimum_charge_adjustment: 0,
                  }
                : null
              : saved,
          error: null,
        })),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: [
              {
                name_snapshot: 'Regular Size Room',
                line_total: 400,
                excluded_at: null,
                service_catalog_items: {
                  category: 'Carpet Cleaning',
                  name: 'Regular Size Room',
                },
              },
            ],
            error: null,
          }).then(resolve),
      }
      return query
    })
    return {
      client: { from } as unknown as SupabaseClient,
      from,
      saved: () => saved,
    }
  }

  it('freezes the original net invoice, recipient and rate before editing', async () => {
    const db = baselineDatabase()
    await captureAddOnBonusBaseline(db.client, 'job')
    expect(db.saved()).toMatchObject({
      commission_baseline_total: 400,
      invoice_growth_baseline_total: 360,
      invoice_growth_bonus_staff_user_id: 'tech',
      invoice_growth_bonus_rate: 0.1,
    })
  })

  it('allows visits without an individual invoice without inventing a zero baseline', async () => {
    const db = baselineDatabase(false, '2026-10-25', false)
    await captureAddOnBonusBaseline(db.client, 'monthly-visit')
    expect(db.saved()).toBeNull()
  })

  it('never recaptures a baseline after edits or reassignments', async () => {
    const db = baselineDatabase(true)
    expect(await captureAddOnBonusBaseline(db.client, 'job')).toEqual([
      'carpet_cleaning',
    ])
    expect(db.from).toHaveBeenCalledTimes(1)
    expect(db.saved()).toBeNull()
  })

  it('keeps the legacy snapshot when the new policy has not started', async () => {
    const db = baselineDatabase(false, '2026-11-11')
    await captureAddOnBonusBaseline(db.client, 'job')
    expect(db.saved()).not.toHaveProperty('invoice_growth_baseline_total')
    expect(db.from.mock.calls.some(([table]) => table === 'ops_invoices')).toBe(
      false,
    )
  })
})
