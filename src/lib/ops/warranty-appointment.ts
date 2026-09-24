export const WARRANTY_SERVICE_SLUG = 'warranty-re-clean'

type WarrantyLineItem = {
  name_snapshot?: string | null
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
