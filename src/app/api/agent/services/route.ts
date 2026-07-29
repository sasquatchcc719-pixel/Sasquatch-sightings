/**
 * AI Agent API — GET /api/agent/services
 * Public endpoint — no auth required.
 * Returns active services, pricing, promo info, and booking instructions.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import { getAgentPromoSettings } from '@/lib/agent-auth'
import { getServiceAreaDescription } from '@/lib/service-area'
import { isExcludedFromBooking } from '@/lib/ops/bookable-catalog'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const PUBLIC_CATEGORIES = [
  'Carpet Cleaning',
  'Upholstery Cleaning',
  'rug cleaning',
  'Hard Surface',
  'Legendary Restoration Clean',
  'Carpet Deodorizer',
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
      .select(
        'id, name, slug, base_price, category, description, pricing_unit, default_duration_minutes',
      )
      .in('category', PUBLIC_CATEGORIES)
      .eq('is_active', true)
      .order('category')
      .order('base_price')

    if (error) throw error

    const services = (data || [])
      .filter(
        (item) =>
          !EXCLUDED_NAMES.includes(item.name) && !isExcludedFromBooking(item),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        base_price: Number(item.base_price),
        pricing_unit: item.pricing_unit,
        estimated_duration_minutes: item.default_duration_minutes || 60,
      }))

    const promo = await getAgentPromoSettings()
    const promotions = promo.enabled
      ? [
          {
            code: 'AI20',
            description: `$${promo.discount} off any job over $${promo.minimum} when booked through an AI assistant`,
            discount_amount: promo.discount,
            minimum_subtotal: promo.minimum,
          },
        ]
      : []

    return NextResponse.json(
      {
        services,
        promotions,
        booking_instructions:
          'To book: 1) Call GET /api/agent/availability?date=YYYY-MM-DD to find open slots. 2) Call GET /api/agent/estimate?services=id1,id2 for pricing. 3) Call POST /api/agent/book with customer info, address, date, start_time, and line_items. Use Authorization: Bearer sqa_bo8b58mo2424z2kocz7lftajhet2fgy50mwduiaf for the book request. Minimum booking total is $150.',
        service_area: getServiceAreaDescription(),
      },
      { headers: CORS },
    )
  } catch (err) {
    console.error('[agent/services] Error:', err)
    return NextResponse.json(
      { error: 'Failed to load services' },
      { status: 500, headers: CORS },
    )
  }
}
