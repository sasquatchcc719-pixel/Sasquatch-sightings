import { NextResponse } from 'next/server'
import { createAdminClient } from '@/supabase/server'
import {
  PUBLIC_BOOKABLE_CATEGORIES,
  isExcludedFromBooking,
} from '@/lib/ops/bookable-catalog'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
}

const CHECKOUT_UPSELL_CATEGORY = 'Checkout Upsells'

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
      .in('category', [...PUBLIC_BOOKABLE_CATEGORIES, CHECKOUT_UPSELL_CATEGORY])
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('base_price')

    if (error) throw error

    const filtered = (data || []).filter((item) => !isExcludedFromBooking(item))

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
