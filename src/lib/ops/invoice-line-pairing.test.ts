import { describe, expect, it } from 'vitest'
import { pairInvoiceLines } from './invoice-line-pairing'

describe('pairInvoiceLines', () => {
  it('does not re-add a widget-booked job that is already on the invoice', () => {
    // Shane Pruitt, 2026-09-03. The booking widget wrote both sets of rows but
    // linked neither, so the invoice recalc added a second copy of every line
    // and the schedule showed a little over $1,000 for a $544 job.
    const appointmentLines = [
      { id: 'appt-1', name_snapshot: 'Regular Size Room (100 to 200 Sqft)' },
      { id: 'appt-2', name_snapshot: 'Sasquatch Size Room (200 to 400 Sqft)' },
    ]
    const invoiceLines = [
      {
        id: 'inv-1',
        appointment_line_item_id: null,
        description: 'Regular Size Room (100 to 200 Sqft)',
      },
      {
        id: 'inv-2',
        appointment_line_item_id: null,
        description: 'Sasquatch Size Room (200 to 400 Sqft)',
      },
    ]

    const paired = pairInvoiceLines(appointmentLines, invoiceLines)

    expect(paired.map((p) => p.invoiceLineId)).toEqual(['inv-1', 'inv-2'])
    expect(paired.every((p) => p.adopted)).toBe(true)
    // Nothing to insert — that was the whole bug.
    expect(paired.filter((p) => p.invoiceLineId === null)).toHaveLength(0)
  })

  it('prefers the real link over a same-name guess', () => {
    const paired = pairInvoiceLines(
      [
        { id: 'appt-1', name_snapshot: 'Stairs' },
        { id: 'appt-2', name_snapshot: 'Stairs' },
      ],
      [
        { id: 'inv-orphan', appointment_line_item_id: null, description: 'Stairs' },
        { id: 'inv-linked', appointment_line_item_id: 'appt-2', description: 'Stairs' },
      ],
    )

    expect(paired).toEqual([
      { appointmentLineId: 'appt-1', invoiceLineId: 'inv-orphan', adopted: true },
      { appointmentLineId: 'appt-2', invoiceLineId: 'inv-linked', adopted: false },
    ])
  })

  it('adopts each unlinked line at most once', () => {
    // Three rooms of the same name, one stray invoice line: two are genuinely
    // missing and must still be inserted.
    const paired = pairInvoiceLines(
      [
        { id: 'a1', name_snapshot: 'Regular Size Room' },
        { id: 'a2', name_snapshot: 'Regular Size Room' },
        { id: 'a3', name_snapshot: 'Regular Size Room' },
      ],
      [{ id: 'inv-1', appointment_line_item_id: null, description: 'Regular Size Room' }],
    )

    expect(paired.filter((p) => p.adopted)).toHaveLength(1)
    expect(paired.filter((p) => p.invoiceLineId === null)).toHaveLength(2)
  })

  it('inserts a split-off excluded piece that has no invoice line yet', () => {
    // Excluding one viscose rug off a 3-rug line creates a new appointment
    // line. Nothing on the invoice describes it, so it must be inserted.
    const paired = pairInvoiceLines(
      [
        { id: 'a1', name_snapshot: 'Area Rug 5x8' },
        { id: 'a2', name_snapshot: 'Area Rug 5x8 (not cleaned)' },
      ],
      [{ id: 'inv-1', appointment_line_item_id: 'a1', description: 'Area Rug 5x8' }],
    )

    expect(paired[0]).toEqual({
      appointmentLineId: 'a1',
      invoiceLineId: 'inv-1',
      adopted: false,
    })
    expect(paired[1].invoiceLineId).toBeNull()
  })

  it('leaves admin-only invoice lines alone', () => {
    // A line typed straight onto the invoice with no appointment line behind
    // it must not be hijacked by an unrelated appointment line.
    const paired = pairInvoiceLines(
      [{ id: 'a1', name_snapshot: 'Carpet Protector' }],
      [{ id: 'inv-1', appointment_line_item_id: null, description: 'Trip Charge' }],
    )

    expect(paired[0].invoiceLineId).toBeNull()
  })
})
