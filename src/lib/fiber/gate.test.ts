import { describe, expect, it } from 'vitest'
import {
  blockedSummary,
  fiberGateStatus,
  signatureAllowed,
  unitLabel,
  unitsForLine,
} from './gate'

const rugLine = {
  id: 'rug-1',
  name: 'Area Rug 8x11',
  quantity: 3,
  catalogCategory: 'rug cleaning',
  catalogPricingUnit: 'per rug',
}
const carpetLine = {
  id: 'carpet-1',
  name: 'Sasquatch Size Room (200 to 400 Sqft)',
  quantity: 1,
  catalogCategory: 'Carpet Cleaning',
}

describe('fiberGateStatus', () => {
  it('requires one check per physical rug, not per line', () => {
    const [status] = fiberGateStatus([rugLine], [])
    expect(status.unitsRequired).toBe(3)
    expect(status.missingUnits).toEqual([1, 2, 3])
    expect(status.complete).toBe(false)
  })

  it('is still blocked when only some rugs are checked', () => {
    const status = fiberGateStatus(
      [rugLine],
      [
        { appointmentLineItemId: 'rug-1', unitIndex: 1, verdict: 'go' },
        { appointmentLineItemId: 'rug-1', unitIndex: 2, verdict: 'go' },
      ],
    )
    expect(status[0].checkedUnits).toBe(2)
    expect(status[0].missingUnits).toEqual([3])
    expect(signatureAllowed([rugLine], status[0] ? [] : [])).toBe(false)
  })

  it('clears once every rug is checked', () => {
    const checks = [1, 2, 3].map((unitIndex) => ({
      appointmentLineItemId: 'rug-1',
      unitIndex,
      verdict: 'go' as const,
    }))
    expect(signatureAllowed([rugLine], checks)).toBe(true)
  })

  it('does not let three checks on one rug satisfy three rugs', () => {
    // Guards the failure the unique index also prevents at the DB level.
    const checks = [
      { appointmentLineItemId: 'rug-1', unitIndex: 1, verdict: 'go' as const },
      { appointmentLineItemId: 'rug-1', unitIndex: 1, verdict: 'go' as const },
      { appointmentLineItemId: 'rug-1', unitIndex: 1, verdict: 'go' as const },
    ]
    expect(signatureAllowed([rugLine], checks)).toBe(false)
  })

  it('ignores carpet entirely', () => {
    expect(fiberGateStatus([carpetLine], [])).toHaveLength(0)
    expect(signatureAllowed([carpetLine], [])).toBe(true)
  })

  it('ignores excluded lines', () => {
    expect(
      signatureAllowed([{ ...rugLine, excludedAt: '2026-08-12' }], []),
    ).toBe(true)
  })

  it('allows a signature when there is nothing to check', () => {
    expect(signatureAllowed([], [])).toBe(true)
  })

  it('summarizes partial progress for the blocked message', () => {
    const summary = blockedSummary(
      [rugLine, carpetLine],
      [{ appointmentLineItemId: 'rug-1', unitIndex: 1, verdict: 'go' }],
    )
    expect(summary).toEqual(['Area Rug 8x11 (1 of 3 identified)'])
  })

  it('omits the counter for single-unit lines', () => {
    const summary = blockedSummary([{ ...rugLine, quantity: 1 }], [])
    expect(summary).toEqual(['Area Rug 8x11'])
  })
})

describe('unitsForLine', () => {
  it('treats per-square-foot quantity as ONE rug, not hundreds', () => {
    // Real data: "Custom-Size Area Rug Cleaning" priced per_sq_ft with
    // quantity 600. Counting that as 600 rugs would demand 600 checks.
    expect(
      unitsForLine({ quantity: 600, catalogPricingUnit: 'per_sq_ft' }),
    ).toBe(1)
    expect(
      unitsForLine({ quantity: 43.2, catalogPricingUnit: 'per_sq_ft' }),
    ).toBe(1)
  })

  it('treats per-seat quantity as one piece', () => {
    expect(unitsForLine({ quantity: 8, catalogPricingUnit: 'per seat' })).toBe(1)
  })

  it('treats a sectional as ONE piece however many seats it is charged for', () => {
    // Real case: "Sectional (cloth)" is catalogued as `fixed` but quantity 3
    // means three seats of one couch. One couch, one fabric, one check.
    expect(
      unitsForLine({
        name: 'Sectional (cloth)',
        quantity: 3,
        catalogCategory: 'Upholstery Cleaning',
        catalogPricingUnit: 'fixed',
      }),
    ).toBe(1)
  })

  it('treats a set of matching chairs as one piece', () => {
    expect(
      unitsForLine({
        name: 'Dining Chair',
        quantity: 6,
        catalogCategory: 'Upholstery Cleaning',
        catalogPricingUnit: 'fixed',
      }),
    ).toBe(1)
  })

  it('treats hand-typed upholstery as one piece too', () => {
    expect(
      unitsForLine({ name: 'sectional couch', quantity: 4 }),
    ).toBe(1)
  })

  it('still counts rugs separately — they can be different fibers', () => {
    expect(
      unitsForLine({
        name: 'Area Rug 8x11',
        quantity: 3,
        catalogCategory: 'rug cleaning',
        catalogPricingUnit: 'per rug',
      }),
    ).toBe(3)
  })

  it('counts pieces for per-rug and fixed items', () => {
    expect(unitsForLine({ quantity: 3, catalogPricingUnit: 'per rug' })).toBe(3)
    expect(unitsForLine({ quantity: 2, catalogPricingUnit: 'fixed' })).toBe(2)
  })

  it('counts pieces when there is no catalog link', () => {
    expect(unitsForLine({ quantity: 2, catalogPricingUnit: null })).toBe(2)
  })

  it('caps absurd quantities so a typo cannot lock the job', () => {
    expect(unitsForLine({ quantity: 500, catalogPricingUnit: 'fixed' })).toBe(12)
  })

  it('never returns less than one', () => {
    expect(unitsForLine({ quantity: 0, catalogPricingUnit: 'per rug' })).toBe(1)
  })

  it('does not demand 600 checks on a per-sqft rug line', () => {
    const sqftLine = {
      id: 'custom-1',
      name: 'Custom-Size Area Rug Cleaning',
      quantity: 600,
      catalogCategory: 'rug cleaning',
      catalogPricingUnit: 'per_sq_ft',
    }
    const [status] = fiberGateStatus([sqftLine], [])
    expect(status.unitsRequired).toBe(1)
    expect(
      signatureAllowed(
        [sqftLine],
        [{ appointmentLineItemId: 'custom-1', unitIndex: 1, verdict: 'go' }],
      ),
    ).toBe(true)
  })
})

describe('unitLabel', () => {
  it('numbers pieces only when there is more than one', () => {
    expect(unitLabel('Area Rug 8x11', 2, 3)).toBe('Area Rug 8x11 — #2 of 3')
    expect(unitLabel('Area Rug 8x11', 1, 1)).toBe('Area Rug 8x11')
  })
})
