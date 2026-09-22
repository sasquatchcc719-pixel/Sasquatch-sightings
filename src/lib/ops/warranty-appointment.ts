export const WARRANTY_SERVICE_SLUG = 'warranty-re-clean'

type WarrantyAppointment = {
  service_concern_id?: string | null
  ops_appointment_line_items?: Array<{
    service_catalog_items?:
      | { slug?: string | null }
      | Array<{ slug?: string | null }>
      | null
  }>
}

export function isWarrantyAppointment(
  appointment: WarrantyAppointment,
): boolean {
  if (appointment.service_concern_id) return true

  return (appointment.ops_appointment_line_items ?? []).some((line) => {
    const catalogItem = Array.isArray(line.service_catalog_items)
      ? line.service_catalog_items[0]
      : line.service_catalog_items
    return catalogItem?.slug === WARRANTY_SERVICE_SLUG
  })
}
