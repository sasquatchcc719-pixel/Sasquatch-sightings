import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

// Categories and items exposed to the public booking widget
const PUBLIC_CATEGORIES = [
  'Carpet Cleaning',
  'Upholstery Cleaning',
  'rug cleaning',
  'Hard Surface',
  'Legendary Restoration Clean',
]

const CHECKOUT_UPSELL_CATEGORY = 'Checkout Upsells'

// Internal-only items excluded from the public widget
const EXCLUDED_SLUGS = [
  'card-fee',
  'carpet-protector',
  'custom-amount',
  'discount',
  'gratuity',
  'heat-transfer-red-drink-dye-from-carpet',
  'mileage-travel',
  'commercial-carpet-cleaning',
  'low-moisture-encapsulation-cleaning-lvmbonnet',
]
const EXCLUDED_NAMES = [
  'Card fee',
  'Carpet Protector',
  'Custom amount',
  'Discount',
  'Gratuity',
  'Heat transfer Red drink dye from carpet.',
  'Mileage/ Travel',
  'Commercial carpet cleaning',
  'Low Moisture Encapsulation Cleaning LVM/Bonnet',
  'Commercial Deodorizer (Per Sqft)',
  'Auto scrubbing Floors (Lvt/Vinyl/Epoxy)',
  'Seal coat Vinyl/LVT flooring (per foot charge)',
]

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('service_catalog_items')
      .select(
        'id, name, slug, base_price, category, description, pricing_unit, sort_order',
      )
      .in('category', [...PUBLIC_CATEGORIES, CHECKOUT_UPSELL_CATEGORY])
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('base_price')

    if (error) throw error

    const filtered = (data || []).filter(
      (item) =>
        !EXCLUDED_SLUGS.includes(item.slug) &&
        !EXCLUDED_NAMES.includes(item.name),
    )

    const services = filtered.filter(
      (item) => item.category !== CHECKOUT_UPSELL_CATEGORY,
    )
    const checkoutUpsells = filtered.filter(
      (item) => item.category === CHECKOUT_UPSELL_CATEGORY,
    )

    return NextResponse.json({ services, checkoutUpsells }, { headers: CORS })
  } catch (error) {
    console.error('[public/services] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load services' },
      { status: 500, headers: CORS },
    )
  }
}
