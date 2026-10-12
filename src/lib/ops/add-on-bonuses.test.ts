import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  discountedEligibleRevenue,
  isNewQualifyingServiceCategory,
  qualifyingAddOnCategory,
  loadAddOnBonuses,
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
  ) {
    const appointments = Array.from(
      { length: appointmentCount },
      (_, index) => ({
        id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        appointment_date: '2026-10-06',
        ops_customers: { full_name: 'Customer', business_name: null },
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
                      payment_status: 'paid',
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
