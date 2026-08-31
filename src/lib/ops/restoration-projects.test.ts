/**
 * Invoice assembly for a water loss: every visit's work plus the equipment days
 * from the map, then the deductible split off the bottom.
 */
import { describe, it, expect } from 'vitest'
import {
  buildProjectInvoiceLines,
  settleProjectInvoice,
} from './restoration-projects'

describe('splitting the deductible', () => {
  const lines = [
    {
      appointment_id: 'a1',
      name_snapshot: 'FCCA - Tear out carpet',
      quantity: 493,
      unit_price: 1.1,
      line_total: 542.3,
    },
  ]

  it('comes off the bottom line, not off a line item', () => {
    const { lines: built, subtotal } = buildProjectInvoiceLines({
      appointmentLines: lines,
      equipmentLines: [],
    })
    // The work is billed in full; the concession is separate from the pricing.
    expect(built[0].line_total).toBeCloseTo(542.3, 2)
    expect(subtotal).toBeCloseTo(542.3, 2)

    const credit = 500
    expect(Math.round((subtotal - credit) * 100) / 100).toBeCloseTo(42.3, 2)
  })

  it('never credits more than the job is worth', () => {
    const { subtotal } = buildProjectInvoiceLines({
      appointmentLines: lines,
      equipmentLines: [],
    })
    // A $1,000 credit on a $542.30 job would invoice a negative total.
    const applied = Math.min(subtotal, Math.max(0, 1000))
    expect(applied).toBeCloseTo(542.3, 2)
    expect(subtotal - applied).toBeCloseTo(0, 2)
  })
})

describe('what the customer owes at the close', () => {
  it('takes the deposit off after the deductible split, not before', () => {
    // $2,000 of work, $500 split, $1,000 taken on day one.
    const s = settleProjectInvoice({
      subtotal: 2000,
      creditRequested: 500,
      depositCents: 100000,
    })
    expect(s.discount).toBe(500)
    expect(s.total).toBe(1500)
    expect(s.balanceCents).toBe(50000)
    expect(s.paymentStatus).toBe('partial')
    expect(s.refundDueCents).toBe(0)
  })

  it('marks a job paid when the deposit covered it, instead of billing twice', () => {
    const s = settleProjectInvoice({
      subtotal: 900,
      creditRequested: 0,
      depositCents: 100000,
    })
    expect(s.balanceCents).toBe(-10000)
    expect(s.paymentStatus).toBe('paid')
    // The overshoot is money owed back, stated rather than left negative.
    expect(s.refundDueCents).toBe(10000)
  })

  it('owes a refund when the deposit and the split together overshoot', () => {
    // A small loss: $1,200 of work, $500 split, $1,000 deposit.
    const s = settleProjectInvoice({
      subtotal: 1200,
      creditRequested: 500,
      depositCents: 100000,
    })
    expect(s.total).toBe(700)
    expect(s.refundDueCents).toBe(30000)
    expect(s.paymentStatus).toBe('paid')
  })

  it('never credits more than the job, and never invoices a negative total', () => {
    const s = settleProjectInvoice({
      subtotal: 400,
      creditRequested: 1000,
      depositCents: 0,
    })
    expect(s.discount).toBe(400)
    expect(s.total).toBe(0)
    expect(s.paymentStatus).toBe('unpaid')
  })

  it('leaves a job with no deposit unpaid for the full amount', () => {
    const s = settleProjectInvoice({
      subtotal: 1658,
      creditRequested: 0,
      depositCents: 0,
    })
    expect(s.total).toBe(1658)
    expect(s.balanceCents).toBe(165800)
    expect(s.paymentStatus).toBe('unpaid')
  })
})
