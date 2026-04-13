import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  validateAgentRequest,
  getAgentPromoSettings,
  checkRateLimit,
} from '@/lib/agent-auth'

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

export async function GET(request: Request) {
  try {
    const auth = await validateAgentRequest(request)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error },
        { status: auth.status, headers: CORS },
      )
    }

    const rl = checkRateLimit(auth.key.id, '/api/agent/services')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please slow down.' },
        {
          status: 429,
          headers: {
            ...CORS,
            'Retry-After': String(Math.ceil((rl.retryAfterMs || 60000) / 1000)),
          },
        },
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('service_catalog_items')
      .select(
        'id, name, base_price, category, description, pricing_unit, default_duration_minutes',
      )
      .in('category', PUBLIC_CATEGORIES)
      .eq('is_active', true)
      .order('category')
      .order('base_price')

    if (error) throw error

    const services = (data || [])
      .filter((item) => !EXCLUDED_NAMES.includes(item.name))
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
            description: `$${promo.discount} off any job over $${promo.minimum} when booked through this service`,
            discount_amount: promo.discount,
            minimum_subtotal: promo.minimum,
            type: 'fixed',
          },
        ]
      : []

    return NextResponse.json(
      {
        services,
        promotions,
        booking_instructions:
          'To book a job: 1) Use GET /api/agent/availability to find open time slots. 2) Use GET /api/agent/estimate to get a price quote. 3) Use POST /api/agent/book with the customer details and selected services.',
        service_area:
          'Colorado Springs, Monument, Fountain, Falcon, Peyton, Black Forest, Woodland Park, and surrounding areas in Colorado.',
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
