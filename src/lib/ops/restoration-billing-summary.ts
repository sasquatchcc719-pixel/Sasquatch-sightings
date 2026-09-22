export type BillingWorkLine = {
  id: string
  description: string
  appointmentDate: string
  visitType: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  lineTotal: number
}

export type BillingEquipmentBatch = {
  placedOn: string
  removedOn: string | null
  units: number
}

export type BillingEquipmentLine = {
  code: string
  description: string
  units: number
  unitDays: number
  unitPrice: number
  lineTotal: number
  running: number
  pulled: number
  batches: BillingEquipmentBatch[]
}

type VisitInput = {
  appointment_date: string
  visit_type: string | null
  ops_appointment_line_items: Array<{
    id: string
    name_snapshot: string
    quantity: number
    pricing_unit_snapshot: string | null
    unit_price: number
    line_total: number
  }>
}

type PlacementInput = {
  catalog_code: string
  placed_on: string
  removed_on: string | null
}

type EquipmentBillingInput = {
  catalog_code: string
  description: string
  units: number
  unit_days: number
  unit_price: number
  line_total: number
}

/**
 * Build the visible, job-wide billing ledger without recalculating money.
 *
 * Amounts and unit-days come straight from the server's billing response. The
 * placement rows only explain those amounts with the dates and running status
 * a person needs to audit them.
 */
export function buildRestorationBillingSummary(input: {
  visits: VisitInput[]
  equipment: PlacementInput[]
  equipmentBilling: EquipmentBillingInput[]
}): {
  work: BillingWorkLine[]
  equipment: BillingEquipmentLine[]
} {
  const work = input.visits.flatMap((visit) =>
    visit.ops_appointment_line_items.map((line) => ({
      id: line.id,
      description: line.name_snapshot,
      appointmentDate: visit.appointment_date,
      visitType: visit.visit_type,
      quantity: Number(line.quantity),
      unit: line.pricing_unit_snapshot,
      unitPrice: Number(line.unit_price),
      lineTotal: Number(line.line_total),
    })),
  )

  const equipment = input.equipmentBilling.map((billing) => {
    const placements = input.equipment.filter(
      (placement) => placement.catalog_code === billing.catalog_code,
    )
    const grouped = new Map<string, BillingEquipmentBatch>()

    for (const placement of placements) {
      const key = `${placement.placed_on}|${placement.removed_on ?? ''}`
      const batch = grouped.get(key) ?? {
        placedOn: placement.placed_on,
        removedOn: placement.removed_on,
        units: 0,
      }
      batch.units += 1
      grouped.set(key, batch)
    }

    return {
      code: billing.catalog_code,
      description: billing.description,
      units: Number(billing.units),
      unitDays: Number(billing.unit_days),
      unitPrice: Number(billing.unit_price),
      lineTotal: Number(billing.line_total),
      running: placements.filter((placement) => !placement.removed_on).length,
      pulled: placements.filter((placement) => placement.removed_on).length,
      batches: [...grouped.values()].sort((a, b) => {
        const placed = a.placedOn.localeCompare(b.placedOn)
        if (placed !== 0) return placed
        if (a.removedOn === b.removedOn) return 0
        if (a.removedOn === null) return -1
        if (b.removedOn === null) return 1
        return a.removedOn.localeCompare(b.removedOn)
      }),
    }
  })

  return { work, equipment }
}
