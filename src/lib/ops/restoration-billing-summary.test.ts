import { describe, expect, it } from 'vitest'
import { buildRestorationBillingSummary } from './restoration-billing-summary'

describe('buildRestorationBillingSummary', () => {
  it('includes work from every visit with its original server amounts', () => {
    const summary = buildRestorationBillingSummary({
      visits: [
        {
          appointment_date: '2026-09-11',
          visit_type: 'mitigation',
          ops_appointment_line_items: [
            {
              id: 'extract',
              name_snapshot: 'EXT - Water extraction',
              quantity: 400,
              pricing_unit_snapshot: 'SF',
              unit_price: 0.58,
              line_total: 232,
            },
          ],
        },
        {
          appointment_date: '2026-09-12',
          visit_type: 'monitor',
          ops_appointment_line_items: [
            {
              id: 'monitor',
              name_snapshot: 'DAILYMON - Daily monitoring',
              quantity: 1,
              pricing_unit_snapshot: 'HR',
              unit_price: 92.65,
              line_total: 92.65,
            },
          ],
        },
      ],
      equipment: [],
      equipmentBilling: [],
    })

    expect(summary.work).toEqual([
      expect.objectContaining({
        id: 'extract',
        appointmentDate: '2026-09-11',
        lineTotal: 232,
      }),
      expect.objectContaining({
        id: 'monitor',
        appointmentDate: '2026-09-12',
        lineTotal: 92.65,
      }),
    ])
  })

  it('uses authoritative equipment billing and explains it with placement batches', () => {
    const summary = buildRestorationBillingSummary({
      visits: [],
      equipment: [
        {
          catalog_code: 'DHM>',
          placed_on: '2026-09-11',
          removed_on: null,
        },
        {
          catalog_code: 'DHM>',
          placed_on: '2026-09-11',
          removed_on: '2026-09-14',
        },
      ],
      equipmentBilling: [
        {
          catalog_code: 'DHM>',
          description: 'Small dehumidifier',
          units: 2,
          unit_days: 13,
          unit_price: 72.5,
          line_total: 942.5,
        },
      ],
    })

    expect(summary.equipment).toEqual([
      expect.objectContaining({
        code: 'DHM>',
        units: 2,
        unitDays: 13,
        unitPrice: 72.5,
        lineTotal: 942.5,
        running: 1,
        pulled: 1,
        batches: [
          { placedOn: '2026-09-11', removedOn: null, units: 1 },
          { placedOn: '2026-09-11', removedOn: '2026-09-14', units: 1 },
        ],
      }),
    ])
  })

  it('returns clear empty collections when the job has no charges', () => {
    expect(
      buildRestorationBillingSummary({
        visits: [],
        equipment: [],
        equipmentBilling: [],
      }),
    ).toEqual({ work: [], equipment: [] })
  })
})
