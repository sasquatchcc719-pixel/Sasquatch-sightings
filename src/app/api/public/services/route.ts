import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Categories and items exposed to the public booking widget
const PUBLIC_CATEGORIES = [
  'Carpet Cleaning',
  'Upholstery Cleaning',
  'rug cleaning',
  'Hard Surface',
  'Legendary Restoration Clean',
]

// Internal-only items excluded from the public widget
const EXCLUDED_SLUGS = [
  'card-fee',
  'custom-amount',
  'discount',
  'gratuity',
  'mileage-travel',
  'commercial-carpet-cleaning',
  'low-moisture-encapsulation-cleaning-lvmbonnet',
]
const EXCLUDED_NAMES = [
  'Card fee',
  'Custom amount',
  'Discount',
  'Gratuity',
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
      .select('id, name, base_price, category, description, pricing_unit')
      .in('category', PUBLIC_CATEGORIES)
      .eq('is_active', true)
      .order('category')
      .order('base_price')

    if (error) throw error

    const filtered = (data || []).filter(
      (item) => !EXCLUDED_NAMES.includes(item.name),
    )

    return NextResponse.json({ services: filtered }, { headers: CORS })
  } catch (error) {
    console.error('[public/services] Error:', error)
    return NextResponse.json(
      { error: 'Failed to load services' },
      { status: 500, headers: CORS },
    )
  }
}
