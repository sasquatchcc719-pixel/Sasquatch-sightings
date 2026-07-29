/**
 * The single source of truth for "which catalog items a customer can book."
 *
 * Used by both the public booking widget (/api/public/services) and Harry's
 * booking menu, so the two can never drift. It excludes water-damage Restoration
 * gear, internal/fee line items, and other back-office entries — leaving only the
 * real services a customer would book.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const PUBLIC_BOOKABLE_CATEGORIES = [
  'Carpet Cleaning',
  'Upholstery Cleaning',
  'rug cleaning',
  'Hard Surface',
  'Legendary Restoration Clean',
] as const

export const BOOKING_EXCLUDED_SLUGS = [
  'card-fee',
  'carpet-protector',
  'custom-amount',
  'discount',
  'dryer-duct-cleaning',
  'gratuity',
  'heat-transfer-red-drink-dye-from-carpet',
  'mileage-travel',
  'commercial-carpet-cleaning',
  'low-moisture-encapsulation-cleaning-lvmbonnet',
]

export const BOOKING_EXCLUDED_NAMES = [
  'Card fee',
  'Carpet Protector',
  'Custom amount',
  'Discount',
  'Dryer Duct Cleaning',
  'Dryer Duct cleaning',
  'Gratuity',
  'Heat transfer Red drink dye from carpet.',
  'Mileage/ Travel',
  'Commercial carpet cleaning',
  'Low Moisture Encapsulation Cleaning LVM/Bonnet',
  'Commercial Deodorizer (Per Sqft)',
  'Auto scrubbing Floors (Lvt/Vinyl/Epoxy)',
  'Seal coat Vinyl/LVT flooring (per foot charge)',
]

export function isExcludedFromBooking(item: {
  slug?: string | null
  name: string
}): boolean {
  return (
    BOOKING_EXCLUDED_SLUGS.includes(item.slug ?? '') ||
    BOOKING_EXCLUDED_NAMES.includes(item.name)
  )
}

export type BookableCatalogRow = {
  id: string
  name: string
  slug: string | null
  base_price: number | null
  pricing_unit: string
  category: string
}

/** Load the customer-bookable services — the same set the website widget shows. */
export async function loadBookableCatalog(
  supabase: SupabaseClient,
): Promise<BookableCatalogRow[]> {
  const { data } = await supabase
    .from('service_catalog_items')
    .select('id, name, slug, base_price, pricing_unit, category')
    .in('category', PUBLIC_BOOKABLE_CATEGORIES as unknown as string[])
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('base_price')

  return (data ?? [])
    .filter((row) => !isExcludedFromBooking(row))
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      slug: row.slug ? String(row.slug) : null,
      base_price: row.base_price == null ? null : Number(row.base_price),
      pricing_unit: String(row.pricing_unit),
      category: String(row.category),
    }))
}
