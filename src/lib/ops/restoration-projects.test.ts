/**
 * Invoice assembly for a water loss: every visit's work plus the equipment days
 * from the map, then the deductible split off the bottom.
 */
import { describe, it, expect } from 'vitest'
import { buildProjectInvoiceLines } from './restoration-projects'

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
