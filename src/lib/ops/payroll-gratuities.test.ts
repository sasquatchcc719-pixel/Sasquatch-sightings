import { describe, expect, it, vi } from 'vitest'
import {
  DAVID_PAYROLL_STAFF_ID,
  loadPayrollGratuities,
  summarizePayrollGratuities,
} from './payroll-gratuities'

function invoice(id = 'invoice-1') {
  return {
    id,
    invoice_number: 18885,
    status: 'paid',
    payment_status: 'paid',
    payment_method: 'square',
    ops_appointments: {
      appointment_date: '2026-10-14',
      assigned_staff_user_id: DAVID_PAYROLL_STAFF_ID,
      status: 'completed',
      kind: 'service',
      ops_customers: { full_name: 'Customer', business_name: null },
    },
    ops_invoice_line_items: [
      {
        id: 'tip',
        description: 'Gratuity',
        line_total: '50.00',
        excluded_at: null as string | null,
        service_catalog_items: null as null | { name: string; slug: string },
      },
    ],
  }
}

describe('payroll gratuities', () => {
  it('includes 100% of catalog and legacy check/Square gratuity once', () => {
    const square = invoice()
    square.ops_invoice_line_items[0].description = 'Thank you'
    square.ops_invoice_line_items[0].service_catalog_items = {
      name: 'Gratuity',
      slug: 'gratuity',
    }
    square.ops_invoice_line_items.push({ ...square.ops_invoice_line_items[0] })
    const check = invoice('check')
    check.payment_method = 'check'
    check.ops_invoice_line_items[0].description = '  gRaTuItY  '
    check.ops_invoice_line_items[0].line_total = '25.00'
    const summary = summarizePayrollGratuities([square, check, square])
    expect(summary.payableGratuity).toBe(75)
    expect(summary.rows).toHaveLength(2)
    expect(summary.rows[0].staffUserId).toBe(DAVID_PAYROLL_STAFF_ID)
  })

  it('keeps unpaid, partial and waived invoices out of payable gross', () => {
    for (const status of ['unpaid', 'partial', 'waived']) {
      const row = invoice()
      row.payment_status = status
      const summary = summarizePayrollGratuities([row])
      expect(summary.payableGratuity).toBe(0)
      expect(summary.pendingGratuity).toBe(50)
    }
  })

  it('excludes other technicians, direct cash, void/draft invoices and cancelled work', () => {
    const owner = invoice('owner')
    owner.ops_appointments.assigned_staff_user_id = 'owner'
    const cash = invoice('cash')
    cash.payment_method = 'cash'
    const voided = invoice('void')
    voided.status = 'void'
    const draft = invoice('draft')
    draft.status = 'draft'
    const cancelled = invoice('cancelled')
    cancelled.ops_appointments.status = 'cancelled'
    const estimate = invoice('estimate')
    estimate.ops_appointments.kind = 'estimate'
    expect(
      summarizePayrollGratuities([
        owner,
        cash,
        voided,
        draft,
        cancelled,
        estimate,
      ]).rows,
    ).toEqual([])
  })

  it('ignores excluded lines and service names containing tip, and nets recorded tip adjustments', () => {
    const row = invoice()
    row.ops_invoice_line_items.push(
      {
        ...row.ops_invoice_line_items[0],
        id: 'excluded',
        excluded_at: '2026-10-14',
      },
      {
        ...row.ops_invoice_line_items[0],
        id: 'service',
        description: 'Tip-top carpet cleaning',
      },
      {
        ...row.ops_invoice_line_items[0],
        id: 'adjustment',
        description: 'Tip',
        line_total: '-10.10',
      },
      { ...row.ops_invoice_line_items[0], id: 'invalid', line_total: 'NaN' },
    )
    expect(summarizePayrollGratuities([row]).payableGratuity).toBe(39.9)
  })

  it('loads every invoice page and surfaces database failures instead of zero tips', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi
        .fn()
        .mockResolvedValueOnce({
          data: Array.from({ length: 500 }, (_, i) => invoice(`invoice-${i}`)),
          error: null,
        })
        .mockResolvedValueOnce({ data: [invoice('last')], error: null }),
    }
    const db = { from: vi.fn(() => query) } as unknown as Parameters<
      typeof loadPayrollGratuities
    >[0]
    expect(
      (
        await loadPayrollGratuities(db, {
          startDate: '2026-10-11',
          endDate: '2026-10-24',
        })
      ).payableGratuity,
    ).toBe(25050)
    expect(query.range).toHaveBeenLastCalledWith(500, 999)
    query.range.mockResolvedValueOnce({
      data: null,
      error: new Error('database unavailable'),
    })
    await expect(
      loadPayrollGratuities(db, {
        startDate: '2026-10-11',
        endDate: '2026-10-24',
      }),
    ).rejects.toThrow('database unavailable')
    db.from = vi.fn()
    expect(
      (
        await loadPayrollGratuities(db, {
          startDate: '2026-10-11',
          endDate: '2026-10-24',
          staffUserId: 'owner',
        })
      ).rows,
    ).toEqual([])
    expect(db.from).not.toHaveBeenCalled()
  })
})
