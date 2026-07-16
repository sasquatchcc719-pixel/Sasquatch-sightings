import { describe, expect, it } from 'vitest'
import {
  canViewTechAppointment,
  getTechStatusTransitionError,
  isActiveTechJobStatus,
  mapTechAppointment,
  shouldHideTechPricing,
} from './appointments'

function baseAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    appointment_date: '2026-05-07',
    start_time: '09:00:00',
    end_time: '11:00:00',
    status: 'booked',
    payment_status: 'unpaid',
    quoted_total: 325,
    internal_notes: 'Bring hose',
    ops_customers: {
      full_name: 'Jane Customer',
      first_name: 'Jane',
      last_name: 'Customer',
      business_name: null,
      phone: '555-1234',
      email: 'jane@example.com',
    },
    ops_service_addresses: {
      street_1: '123 Main St',
      street_2: null,
      city: 'Monument',
      state: 'CO',
      zip_code: '80132',
      gate_code: null,
      notes: null,
      latitude: null,
      longitude: null,
    },
    ops_appointment_line_items: [
      {
        id: 'line-1',
        name_snapshot: 'Carpet cleaning',
        quantity: 1,
        unit_price: 325,
        line_total: 325,
        notes: null,
      },
    ],
    ops_invoices: {
      id: 'invoice-1',
      status: 'draft',
      payment_status: 'unpaid',
      payment_method: null,
      total: 325,
      signature_url: null,
      signature_captured_at: null,
      signature_customer_name: null,
      ops_invoice_line_items: [
        {
          id: 'invoice-line-1',
          appointment_line_item_id: 'line-1',
        },
      ],
    },
    ops_recurring_templates: {
      invoice_mode: 'per_visit',
    },
    ops_job_photos: [],
    ...overrides,
  }
}

describe('tech appointment pricing redaction', () => {
  it('keeps pricing for standard jobs', () => {
    const row = baseAppointment()

    expect(shouldHideTechPricing(row)).toBe(false)

    const mapped = mapTechAppointment(row)
    expect(mapped.hidePricing).toBe(false)
    expect(mapped.quotedTotal).toBe(325)
    expect(mapped.invoice?.total).toBe(325)
    expect(mapped.lineItems[0].unitPrice).toBe(325)
    expect(mapped.lineItems[0].lineTotal).toBe(325)
    expect(mapped.lineItems[0].invoiceLineId).toBe('invoice-line-1')
  })

  it('hides pricing for Recovery Village jobs', () => {
    const row = baseAppointment({
      ops_customers: {
        full_name: 'Recovery Village',
        first_name: null,
        last_name: null,
        business_name: 'Recovery Village',
        phone: '555-9999',
        email: 'rv@example.com',
      },
    })

    expect(shouldHideTechPricing(row)).toBe(true)

    const mapped = mapTechAppointment(row)
    expect(mapped.hidePricing).toBe(true)
    expect(mapped.quotedTotal).toBeNull()
    expect(mapped.invoice?.total).toBeNull()
    expect(mapped.lineItems[0].unitPrice).toBeNull()
    expect(mapped.lineItems[0].lineTotal).toBeNull()
  })

  it('hides pricing for batch monthly recurring jobs', () => {
    const row = baseAppointment({
      ops_recurring_templates: {
        invoice_mode: 'batch_monthly',
      },
    })

    expect(shouldHideTechPricing(row)).toBe(true)
    expect(mapTechAppointment(row).invoice?.total).toBeNull()
  })
})

describe('tech appointment access', () => {
  it('limits technicians to their own assigned jobs', () => {
    expect(canViewTechAppointment('tech', 'staff-1', 'staff-1')).toBe(true)
    expect(canViewTechAppointment('tech', 'staff-1', 'staff-2')).toBe(false)
  })

  it('allows owners and admins to view another technician assignment', () => {
    expect(canViewTechAppointment('owner', 'owner-staff', 'staff-2')).toBe(true)
    expect(canViewTechAppointment('admin', null, 'staff-2')).toBe(true)
  })
})

describe('tech appointment status safety', () => {
  it('prevents a completed job from being restarted in the tech portal', () => {
    expect(getTechStatusTransitionError('completed', 'in_progress')).toBe(
      'Completed jobs can only be reopened from Operations',
    )
    expect(getTechStatusTransitionError('completed', 'on_my_way')).toBe(
      'Completed jobs can only be reopened from Operations',
    )
  })

  it('allows normal forward progress and an idempotent completion', () => {
    expect(getTechStatusTransitionError('booked', 'on_my_way')).toBeNull()
    expect(getTechStatusTransitionError('on_my_way', 'in_progress')).toBeNull()
    expect(getTechStatusTransitionError('in_progress', 'completed')).toBeNull()
    expect(getTechStatusTransitionError('completed', 'completed')).toBeNull()
  })

  it('identifies statuses that conflict with another active job', () => {
    expect(isActiveTechJobStatus('on_my_way')).toBe(true)
    expect(isActiveTechJobStatus('in_progress')).toBe(true)
    expect(isActiveTechJobStatus('booked')).toBe(false)
    expect(isActiveTechJobStatus('completed')).toBe(false)
  })
})
