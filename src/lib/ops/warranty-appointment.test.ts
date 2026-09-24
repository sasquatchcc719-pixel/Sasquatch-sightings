import { describe, expect, it } from 'vitest'
import {
  getWarrantyWorkDurationMinutes,
  isWarrantyAppointment,
  isWarrantyLineItem,
} from '@/lib/ops/warranty-appointment'

describe('warranty appointment classification', () => {
  it('recognizes a return linked to a service concern', () => {
    expect(
      isWarrantyAppointment({
        service_concern_id: 'concern-1',
        ops_appointment_line_items: [],
      }),
    ).toBe(true)
  })

  it('recognizes the canonical warranty catalog item', () => {
    expect(
      isWarrantyLineItem({
        name_snapshot: 'Old display name',
        service_catalog_items: { slug: 'warranty-re-clean' },
      }),
    ).toBe(true)
  })

  it('recognizes legacy warranty snapshots without a catalog relation', () => {
    expect(
      isWarrantyAppointment({
        service_concern_id: null,
        ops_appointment_line_items: [
          { name_snapshot: 'Warranty Re-Clean' },
          { name_snapshot: 'Warranty Return — Spot / Stain' },
        ],
      }),
    ).toBe(true)
  })

  it('does not relabel an ordinary zero-dollar appointment', () => {
    expect(
      isWarrantyAppointment({
        service_concern_id: null,
        ops_appointment_line_items: [{ name_snapshot: 'Free UV Inspection' }],
      }),
    ).toBe(false)
  })

  it('uses one hour by default while respecting a deliberately longer warranty visit', () => {
    expect(
      getWarrantyWorkDurationMinutes({
        ops_appointment_line_items: [
          { name_snapshot: 'Warranty Re-Clean', duration_minutes: 0 },
        ],
      }),
    ).toBe(60)

    expect(
      getWarrantyWorkDurationMinutes({
        ops_appointment_line_items: [
          { name_snapshot: 'Warranty Return', duration_minutes: 90 },
        ],
      }),
    ).toBe(90)

    expect(
      getWarrantyWorkDurationMinutes({
        ops_appointment_line_items: [
          {
            name_snapshot: 'Complimentary Spot Cleaning',
            duration_minutes: 30,
          },
        ],
      }),
    ).toBeNull()
  })
})
