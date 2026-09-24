export const WARRANTY_SERVICE_SLUG = 'warranty-re-clean'

type WarrantyLineItem = {
  name_snapshot?: string | null
  duration_minutes?: number | null
  service_catalog_items?:
    | { slug?: string | null }
    | Array<{ slug?: string | null }>
    | null
}

type WarrantyAppointment = {
  service_concern_id?: string | null
  ops_appointment_line_items?: WarrantyLineItem[] | null
}

export function isWarrantyLineItem(line: WarrantyLineItem): boolean {
  const catalogItem = Array.isArray(line.service_catalog_items)
    ? line.service_catalog_items[0]
    : line.service_catalog_items

  if (catalogItem?.slug === WARRANTY_SERVICE_SLUG) return true

  return /^warranty\s+(?:re-?clean|return)\b/i.test(
    line.name_snapshot?.trim() || '',
  )
}

export function isWarrantyAppointment(
  appointment: WarrantyAppointment,
): boolean {
  if (appointment.service_concern_id) return true

  return (appointment.ops_appointment_line_items ?? []).some(isWarrantyLineItem)
}

/**
 * Warranty work gets a compact one-hour calendar block by default. A longer
 * catalog duration is still respected so an admin can deliberately reserve
 * more time for an unusual return visit.
 */
export function getWarrantyWorkDurationMinutes(
  appointment: WarrantyAppointment,
): number | null {
  if (!isWarrantyAppointment(appointment)) return null

  const configuredMinutes = (appointment.ops_appointment_line_items ?? [])
    .filter(isWarrantyLineItem)
    .reduce(
      (longest, line) => Math.max(longest, Number(line.duration_minutes || 0)),
      0,
    )

  return Math.max(60, configuredMinutes)
}
